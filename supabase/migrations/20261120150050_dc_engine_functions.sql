-- =====================================================================
-- DC capture engine: metadata-driven rule resolution, row guard and
-- conditional-required validation (mirrors app/src/lib/engine.ts).
-- =====================================================================

-- code of a value in a row: lookups resolve to their code, booleans to 'true'/'false'
create or replace function dc.value_code(p_pillar text, p_key text, p_row jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text := p_row->>p_key; t text;
begin
  if v is null or p_key is null then return null; end if;
  select d.data_type into t from public.dc_field_defs d where d.pillar = p_pillar and d.key = p_key;
  if t = 'lookup' then
    return (select l.code from public.dc_lookups l where l.id::text = v);
  end if;
  return v;
end;
$$;

-- effective state of every field of a pillar for one row (most specific rule wins; hide wins a tie)
create or replace function dc.field_state(p_pillar text, p_sector text, p_row jsonb)
returns table (key text, label text, data_type text, visible boolean, required boolean)
language sql stable security definer set search_path = '' as $$
  select d.key, coalesce(r.label_override, d.label), d.data_type,
         coalesce(r.visible, true), coalesce(r.required, d.required)
    from public.dc_field_defs d
    left join lateral (
      select fr.visible, fr.required, fr.label_override
        from public.dc_field_rules fr
       where fr.pillar = d.pillar and fr.key = d.key
         and (fr.sector_code is null or fr.sector_code = p_sector)
         and (fr.criteria_value is null
              or dc.value_code(p_pillar, coalesce(fr.criteria_key,
                   (select pl.criteria_key from public.dc_pillars pl where pl.code = p_pillar)), p_row) = fr.criteria_value)
       order by (case when fr.sector_code is not null then 2 else 0 end
                 + case when fr.criteria_value is not null then 1 else 0 end) desc,
                fr.visible asc
       limit 1
    ) r on true
   where d.pillar = p_pillar
   order by d.sort;
$$;

-- standard/system columns that are not "data"
create or replace function dc.system_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['id','project_id','created_at','created_by','updated_at','updated_by','sample_selected',
               'verification_status','row_locked','source','confirmed','import_job_id','days_to_pay'];
$$;

-- BEFORE INSERT/UPDATE guard for all capture tables
create or replace function dc.capture_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pillar text := tg_argv[0];
  v_role text;
  v_data_changed boolean := false;
begin
  if (select auth.uid()) is null then return new; end if;   -- service role / migrations
  v_role := dc.project_role(new.project_id);

  if tg_op = 'INSERT' then
    if not dc.role_can(v_role, 'verify') then
      new.sample_selected := false;
      new.verification_status := 'unverified';
    end if;
    if not dc.role_can(v_role, 'manage') then
      new.row_locked := false;
    end if;
    return new;
  end if;

  if new.project_id <> old.project_id then
    raise exception 'A row cannot be moved to another project' using errcode = '42501';
  end if;

  select exists (
    select 1 from jsonb_each(to_jsonb(new)) e
     where not (e.key = any (dc.system_keys()))
       and (to_jsonb(old)->e.key) is distinct from e.value
  ) into v_data_changed;

  if v_data_changed and not dc.role_can(v_role, 'capture') then
    raise exception 'Your role (%) cannot edit capture data', coalesce(v_role,'none') using errcode = '42501';
  end if;
  if (new.sample_selected, new.verification_status) is distinct from (old.sample_selected, old.verification_status)
     and not dc.role_can(v_role, 'verify') then
    raise exception 'Only a verifier or consultant can change sampling or verification status' using errcode = '42501';
  end if;
  if new.row_locked is distinct from old.row_locked and not dc.role_can(v_role, 'verify') then
    raise exception 'Only a verifier or consultant can lock rows' using errcode = '42501';
  end if;
  if old.source = 'carried_forward' and v_data_changed then
    new.confirmed := true;
  end if;
  return new;
end;
$$;

-- BEFORE INSERT/UPDATE: conditional-required rules + pillar-specific checks
create or replace function dc.validate_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pillar text := tg_argv[0];
  v_sector text;
  v_period_start date;
  v_row jsonb := to_jsonb(new);
  f record;
  v_code text;
  v_dob date;
  v_age int;
begin
  select p.sector_code, p.period_start into v_sector, v_period_start
    from public.dc_projects p where p.id = new.project_id;

  for f in select * from dc.field_state(v_pillar, v_sector, v_row) loop
    if f.visible and f.required and nullif(v_row->>f.key, '') is null then
      raise exception 'Required field missing: %', f.label using errcode = '23502', hint = f.key;
    end if;
  end loop;

  if v_pillar = 'skills_development' and v_row->>'criteria' = 'sd_learners' and v_row->>'learning_category' is not null then
    select l.code into v_code from public.dc_lookups l where l.id = (v_row->>'learning_category')::uuid;
    if v_code not in ('B','C','D') then
      raise exception 'Learnerships must use learning category B, C or D' using errcode = '23514', hint = 'learning_category';
    end if;
  end if;

  if v_pillar = 'yes' and v_row->>'person_id' is not null then
    select dc.sa_id_dob(pp.id_number) into v_dob from public.dc_people pp where pp.id = (v_row->>'person_id')::uuid;
    if v_dob is not null then
      v_age := extract(year from age(coalesce((v_row->>'start_date')::date, v_period_start, current_date), v_dob))::int;
      if v_age < 18 or v_age > 35 then
        raise exception 'Y.E.S. participants must be 18–35 at start date (this person is %)', v_age
          using errcode = '23514', hint = 'person_id';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on all functions in schema dc from public, anon;
grant execute on all functions in schema dc to authenticated, service_role;
