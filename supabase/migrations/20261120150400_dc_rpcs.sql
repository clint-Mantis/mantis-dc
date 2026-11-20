-- =====================================================================
-- RPCs used by the app (public.dc_* functions). SECURITY DEFINER ones
-- check access themselves through the dc.* helpers.
-- =====================================================================

-- who am I, and which organisations can I switch between
create or replace function public.dc_my_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'email', (select u.email from auth.users u where u.id = (select auth.uid())),
    'is_admin', dc.is_admin(),
    'is_staff', coalesce(private.is_staff(), false),
    'profile', (select to_jsonb(p) from public.dc_profiles p where p.user_id = (select auth.uid())),
    'orgs', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', x.role) order by o.name)
        from (
          select m.org_id, m.role from public.dc_memberships m where m.user_id = (select auth.uid())
          union
          select p.org_id, 'project_' || pm.role from public.dc_project_members pm
            join public.dc_projects p on p.id = pm.project_id
           where pm.user_id = (select auth.uid())
             and not exists (select 1 from public.dc_memberships m2 where m2.user_id = pm.user_id and m2.org_id = p.org_id)
        ) x join public.organisations o on o.id = x.org_id
    ), '[]'::jsonb),
    'recent_orgs', case when dc.is_admin() or coalesce(private.is_staff(), false) then coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
        from public.organisations o where o.id in (select p.org_id from public.dc_projects p)
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

-- organisation search (admin / Mantis staff see all Hub organisations)
create or replace function public.dc_search_orgs(p_q text, p_limit int default 20)
returns table (id uuid, name text, reg_number text, vat_number text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.reg_number, o.vat_number
    from public.organisations o
   where o.deleted_at is null
     and (dc.is_admin() or coalesce(private.is_staff(), false) or o.id in (select dc.my_orgs('read')))
     and (p_q is null or o.name ilike '%' || p_q || '%' or o.reg_number ilike '%' || p_q || '%')
   order by o.name
   limit least(coalesce(p_limit, 20), 100);
$$;

create or replace function public.dc_create_org(p_name text, p_reg text default null, p_vat text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (dc.is_admin() or coalesce(private.is_staff(), false)) then
    raise exception 'Only Mantis staff can create organisations' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organisation name is required'; end if;
  insert into public.organisations (name, reg_number, vat_number, org_type, status, created_by)
  values (trim(p_name), nullif(trim(p_reg), ''), nullif(trim(p_vat), ''), 'client', 'active', (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- user picker (admins, staff and consultants)
create or replace function public.dc_list_users(p_q text default null, p_limit int default 50)
returns table (id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, coalesce(p.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
    from auth.users u left join public.dc_profiles p on p.user_id = u.id
   where (dc.is_admin() or coalesce(private.is_staff(), false) or exists (select 1 from dc.my_orgs('manage')))
     and (p_q is null or u.email ilike '%' || p_q || '%' or p.full_name ilike '%' || p_q || '%')
   order by u.email
   limit least(coalesce(p_limit, 50), 200);
$$;

-- names for "changed by" columns; only returns users who share a project/org with the caller
create or replace function public.dc_user_names(p_ids uuid[])
returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(p.full_name, u.email::text)
    from auth.users u left join public.dc_profiles p on p.user_id = u.id
   where u.id = any (p_ids)
     and (dc.is_admin() or coalesce(private.is_staff(), false)
          or exists (select 1 from public.dc_memberships m where m.user_id = u.id and m.org_id in (select dc.my_orgs('read')))
          or exists (select 1 from public.dc_project_members pm where pm.user_id = u.id and pm.project_id in (select dc.my_projects('read')))
          or exists (select 1 from public.staff s where s.auth_user_id = u.id));
$$;

-- ---------------------------------------------------------------------
-- Project wizard
-- ---------------------------------------------------------------------
create or replace function public.dc_create_project(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (p->>'org_id')::uuid;
  v_fy date := (p->>'fy_end')::date;
  v_start date;
  v_div uuid := nullif(p->>'division_id', '')::uuid;
  v_id uuid;
  v_title text;
  v_m jsonb;
  v_copy text[];
begin
  if v_org is null or v_fy is null then raise exception 'Organisation and financial year end are required'; end if;
  if not (dc.is_admin() or coalesce(private.is_staff(), false) or dc.has_org_access(v_org, 'manage')) then
    raise exception 'Only a consultant or Mantis admin can create projects' using errcode = '42501';
  end if;
  v_start := (v_fy - interval '1 year')::date + 1;
  v_title := coalesce(nullif(trim(p->>'title'), ''),
    'FY' || extract(year from v_fy)::int || ' (' || to_char(v_start, 'Mon YYYY') || '–' || to_char(v_fy, 'Mon YYYY') || ')');

  if v_div is null and coalesce(trim(p->>'division_name'), '') <> '' then
    insert into public.dc_org_divisions (org_id, name) values (v_org, trim(p->>'division_name'))
    on conflict (org_id, name) do update set name = excluded.name
    returning id into v_div;
  end if;

  insert into public.dc_projects (org_id, division_id, product_id, sector_code, size, title, fy_end, period_start, period_end,
                                  status, data_deadline, verification_date, description, previous_project_id, created_by)
  values (v_org, v_div,
          coalesce(nullif(p->>'product_id','')::uuid, (select pr.id from public.dc_products pr order by pr.code limit 1)),
          coalesce(p->>'sector_code', 'DTI'), coalesce(p->>'size', 'GENERIC'), v_title, v_fy, v_start, v_fy,
          'capturing', nullif(p->>'data_deadline','')::date, nullif(p->>'verification_date','')::date,
          p->>'description', nullif(p->>'previous_project_id','')::uuid, (select auth.uid()))
  returning id into v_id;

  -- creator gets consultant access unless already covered
  if not dc.is_admin() and not dc.has_org_access(v_org, 'manage') then
    insert into public.dc_project_members (project_id, user_id, role) values (v_id, (select auth.uid()), 'consultant');
  end if;
  for v_m in select * from jsonb_array_elements(coalesce(p->'members', '[]'::jsonb)) loop
    insert into public.dc_project_members (project_id, user_id, role)
    values (v_id, (v_m->>'user_id')::uuid, v_m->>'role')
    on conflict (project_id, user_id) do update set role = excluded.role;
  end loop;

  insert into public.dc_pillar_status (project_id, pillar) select v_id, pl.code from public.dc_pillars pl;

  insert into public.dc_evidence_checklist_items (project_id, pillar, title, description, required, sort)
  select v_id, t.pillar, t.title, t.description, t.required, t.sort
    from public.dc_evidence_templates t
   where t.sector_code is null or t.sector_code = coalesce(p->>'sector_code', 'DTI');

  insert into public.dc_fin_sheet (project_id) values (v_id);
  insert into public.dc_fin_history (project_id, year_offset) select v_id, g from generate_series(1,4) g;
  insert into public.dc_fin_sdl_payments (project_id, month_no) select v_id, g from generate_series(1,12) g;

  if p ? 'copy_pillars' and jsonb_array_length(p->'copy_pillars') > 0 and nullif(p->>'previous_project_id','') is not null then
    select array_agg(x) into v_copy from jsonb_array_elements_text(p->'copy_pillars') x;
    perform public.dc_copy_forward((p->>'previous_project_id')::uuid, v_id, v_copy);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Copy forward (Ownership, Management Control, Suppliers)
-- ---------------------------------------------------------------------
create or replace function public.dc_copy_forward(p_from uuid, p_to uuid, p_pillars text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pillar text; v_table text; v_cols text; v_n int; v_out jsonb := '{}'::jsonb;
begin
  if not (dc.has_project_access(p_from, 'read_full') and dc.has_project_access(p_to, 'manage')) then
    raise exception 'You need consultant access to both projects' using errcode = '42501';
  end if;
  if (select org_id from public.dc_projects where id = p_from) <> (select org_id from public.dc_projects where id = p_to) then
    raise exception 'Copy forward only works between projects of the same organisation';
  end if;
  foreach v_pillar in array p_pillars loop
    if v_pillar not in ('ownership','management_control','procurement') then
      raise exception 'Copy forward is available for ownership, management_control and procurement only (got %)', v_pillar;
    end if;
    select table_name into v_table from public.dc_pillars where code = v_pillar;
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_table
       and not (c.column_name = any (dc.system_keys()));
    execute format('insert into public.%I (project_id, source, confirmed, %s) select $1, ''carried_forward'', false, %s from public.%I where project_id = $2',
                   v_table, v_cols, v_cols, v_table) using p_to, p_from;
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object(v_pillar, v_n);
  end loop;
  -- ESD/SED beneficiaries are organisation masters, so they are already available to the new project.
  return v_out;
end;
$$;

-- mark carried-forward rows as confirmed without editing them
create or replace function public.dc_confirm_rows(p_project uuid, p_table text, p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not dc.has_project_access(p_project, 'capture') then raise exception 'No capture access' using errcode = '42501'; end if;
  if not exists (select 1 from public.dc_pillars where table_name = p_table) then raise exception 'Unknown table %', p_table; end if;
  execute format('update public.%I set confirmed = true where project_id = $1 and id = any ($2) and not confirmed', p_table)
    using p_project, p_ids;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Locking, sampling, verification, queries
-- ---------------------------------------------------------------------
create or replace function public.dc_set_pillar_lock(p_project uuid, p_pillar text, p_locked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not dc.has_project_access(p_project, 'manage') then
    raise exception 'Only a consultant or Mantis admin can lock pillars' using errcode = '42501';
  end if;
  insert into public.dc_pillar_status (project_id, pillar, locked, locked_by, locked_at)
  values (p_project, p_pillar, p_locked, case when p_locked then (select auth.uid()) end, case when p_locked then now() end)
  on conflict (project_id, pillar) do update
     set locked = excluded.locked, locked_by = excluded.locked_by, locked_at = excluded.locked_at;
end;
$$;

create or replace function dc.check_table(p_table text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_pillar text;
begin
  select code into v_pillar from public.dc_pillars where table_name = p_table;
  if v_pillar is null then raise exception 'Unknown capture table %', p_table; end if;
  return v_pillar;
end;
$$;

create or replace function public.dc_set_sample(p_project uuid, p_table text, p_ids uuid[], p_selected boolean)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform dc.check_table(p_table);
  if not dc.has_project_access(p_project, 'verify') then raise exception 'Only a verifier or consultant can sample' using errcode = '42501'; end if;
  execute format($f$update public.%I set sample_selected = $3,
                    verification_status = case when $3 and verification_status = 'unverified' then 'sampled'
                                               when not $3 and verification_status = 'sampled' then 'unverified'
                                               else verification_status end
                  where project_id = $1 and id = any ($2)$f$, p_table)
    using p_project, p_ids, p_selected;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.dc_random_sample(p_project uuid, p_pillar text, p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare v_table text; v_n int;
begin
  select table_name into v_table from public.dc_pillars where code = p_pillar;
  if v_table is null then raise exception 'Unknown pillar %', p_pillar; end if;
  if not dc.has_project_access(p_project, 'verify') then raise exception 'Only a verifier or consultant can sample' using errcode = '42501'; end if;
  execute format($f$update public.%I set sample_selected = true,
                    verification_status = case when verification_status = 'unverified' then 'sampled' else verification_status end
                  where id in (select id from public.%I where project_id = $1 and not sample_selected order by random() limit $2)$f$,
                 v_table, v_table)
    using p_project, greatest(coalesce(p_n, 0), 0);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.dc_set_verification(p_project uuid, p_table text, p_ids uuid[], p_status text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform dc.check_table(p_table);
  if p_status not in ('unverified','sampled','queried','verified','rejected') then raise exception 'Bad status %', p_status; end if;
  if not dc.has_project_access(p_project, 'verify') then raise exception 'Only a verifier or consultant can verify' using errcode = '42501'; end if;
  execute format('update public.%I set verification_status = $3 where project_id = $1 and id = any ($2)', p_table)
    using p_project, p_ids, p_status;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.dc_set_row_lock(p_project uuid, p_table text, p_ids uuid[], p_locked boolean)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform dc.check_table(p_table);
  if not dc.has_project_access(p_project, 'verify') then raise exception 'Only a verifier or consultant can lock rows' using errcode = '42501'; end if;
  execute format('update public.%I set row_locked = $3 where project_id = $1 and id = any ($2)', p_table)
    using p_project, p_ids, p_locked;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.dc_raise_query(p_project uuid, p_table text, p_record uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform dc.check_table(p_table);
  if not dc.has_project_access(p_project, 'verify') then raise exception 'Only a verifier or consultant can raise queries' using errcode = '42501'; end if;
  insert into public.dc_record_queries (project_id, record_table, record_id, body)
  values (p_project, p_table, p_record, p_body) returning id into v_id;
  execute format('update public.%I set verification_status = ''queried'' where project_id = $1 and id = $2', p_table)
    using p_project, p_record;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Grid data: one call per pillar, masked for client_viewer, with
-- per-row open-query and evidence counts.
-- ---------------------------------------------------------------------
create or replace function public.dc_list_rows(p_project uuid, p_table text, p_offset int default 0, p_limit int default 5000,
                                               p_samples_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_rows jsonb; v_total int;
begin
  if p_table not in (select table_name from public.dc_pillars union all select 'dc_fin_history' union all select 'dc_fin_sdl_payments') then
    raise exception 'Unknown capture table %', p_table;
  end if;
  if not dc.has_project_access(p_project, 'read') then raise exception 'No access to this project' using errcode = '42501'; end if;
  v_role := dc.project_role(p_project);
  execute format('select count(*)::int from public.%I t where t.project_id = $1 and (not $2 or t.sample_selected)', p_table)
    into v_total using p_project, p_samples_only;
  execute format($f$
    select coalesce(jsonb_agg(r order by (r->>'created_at'), (r->>'id')), '[]'::jsonb) from (
      select to_jsonb(t) || jsonb_build_object(
               '_open_queries', (select count(*) from public.dc_record_queries q where q.record_table = %L and q.record_id = t.id and q.status <> 'closed'),
               '_evidence', (select count(*) from public.dc_evidence_files e where e.record_table = %L and e.record_id = t.id)) r
        from public.%I t
       where t.project_id = $1 and (not $4 or t.sample_selected)
       order by t.created_at, t.id
       offset $2 limit $3) x$f$, p_table, p_table, p_table)
  into v_rows using p_project, greatest(p_offset, 0), least(greatest(p_limit, 1), 20000), p_samples_only;
  if v_role = 'client_viewer' then
    select coalesce(jsonb_agg(r - 'monthly_salary' - 'monthly_stipend'), '[]'::jsonb) into v_rows from jsonb_array_elements(v_rows) r;
  end if;
  return jsonb_build_object('total', coalesce(v_total, 0), 'role', v_role, 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard: one card per pillar
-- ---------------------------------------------------------------------
create or replace function dc.missing_required(p_pillar text, p_sector text, p_row jsonb)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from dc.field_state(p_pillar, p_sector, p_row) s
   where s.visible and s.required and nullif(p_row->>s.key, '') is null;
$$;

-- rows of a pillar with at least one missing required field. Rules only depend on the criteria
-- fields, so field_state is evaluated once per distinct combination instead of once per row.
create or replace function dc.missing_required_rows(p_pillar text, p_sector text, p_table text, p_project uuid)
returns int language plpgsql stable security definer set search_path = '' as $$
declare v_keys text[]; v_n int;
begin
  select coalesce(array_agg(distinct coalesce(r.criteria_key, pl.criteria_key)) filter (where coalesce(r.criteria_key, pl.criteria_key) is not null), '{}')
    into v_keys
    from public.dc_field_rules r join public.dc_pillars pl on pl.code = r.pillar
   where r.pillar = p_pillar and r.criteria_value is not null;
  execute format($f$
    with t as (
      select to_jsonb(x) j,
             coalesce((select jsonb_object_agg(k, to_jsonb(x)->k) from unnest($3::text[]) k), '{}'::jsonb) c
        from public.%I x where x.project_id = $1),
    req as (
      select c, array(select s.key from dc.field_state($2, $4, c) s where s.visible and s.required) keys
        from (select distinct c from t) combos)
    select count(*)::int from t join req on req.c = t.c
     where exists (select 1 from unnest(req.keys) k where nullif(t.j->>k, '') is null)$f$, p_table)
    into v_n using p_project, p_pillar, v_keys, p_sector;
  return v_n;
end;
$$;

create or replace function public.dc_project_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_sector text; pl record; v_rows int; v_missing int; v_unconfirmed int; v_sampled int; v_out jsonb := '[]'::jsonb;
begin
  if not dc.has_project_access(p_project, 'read') then raise exception 'No access to this project' using errcode = '42501'; end if;
  select sector_code into v_sector from public.dc_projects where id = p_project;
  for pl in select * from public.dc_pillars order by sort loop
    execute format($f$select count(*)::int,
                             count(*) filter (where not t.confirmed)::int,
                             count(*) filter (where t.sample_selected)::int
                        from public.%I t where t.project_id = $1$f$, pl.table_name)
      into v_rows, v_unconfirmed, v_sampled using p_project;
    v_missing := case when v_rows = 0 then 0 else dc.missing_required_rows(pl.code, v_sector, pl.table_name, p_project) end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'pillar', pl.code, 'label', pl.label, 'table', pl.table_name, 'mode', pl.mode,
      'rows', v_rows, 'rows_missing_required', v_missing, 'unconfirmed', v_unconfirmed, 'sampled', v_sampled,
      'locked', dc.pillar_locked(p_project, pl.code),
      'evidence_outstanding', (select count(*) from public.dc_evidence_checklist_items c
                                where c.project_id = p_project and c.pillar = pl.code and c.status in ('outstanding','rejected')),
      'evidence_total', (select count(*) from public.dc_evidence_checklist_items c where c.project_id = p_project and c.pillar = pl.code),
      'open_queries', (select count(*) from public.dc_record_queries q where q.project_id = p_project
                         and q.record_table = pl.table_name and q.status <> 'closed')));
  end loop;
  return jsonb_build_object(
    'role', dc.project_role(p_project),
    'pillars', v_out,
    'checklist', (select jsonb_build_object('total', count(*), 'accepted', count(*) filter (where status = 'accepted'),
                                            'outstanding', count(*) filter (where status in ('outstanding','rejected')))
                    from public.dc_evidence_checklist_items where project_id = p_project));
end;
$$;

-- ---------------------------------------------------------------------
-- Import commit: inserts already-validated rows in ONE transaction.
-- SECURITY INVOKER, so RLS and all row triggers apply to every row.
-- mode valid_only: rows the database still rejects are skipped and reported
-- mode all_or_nothing: any rejection rolls back the whole import
-- ---------------------------------------------------------------------
create or replace function public.dc_import_commit(p_job uuid, p_rows jsonb, p_mode text default 'valid_only')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.dc_import_jobs;
  v_table text;
  v_cols text[];
  r jsonb;
  i int := 0;
  v_ok int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_keys text[];
  v_sql text;
  v_msg text;
  v_hint text;
begin
  select * into v_job from public.dc_import_jobs where id = p_job;
  if v_job.id is null then raise exception 'Import job not found or no access'; end if;
  if v_job.status = 'committed' then raise exception 'This import was already committed'; end if;
  select table_name into v_table from public.dc_pillars where code = v_job.pillar;
  select array_agg(c.column_name::text) into v_cols from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = v_table
     and not (c.column_name = any (dc.system_keys()));

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    select array_agg(k) into v_keys from jsonb_object_keys(r) k where k = any (v_cols);
    v_sql := format('insert into public.%I (project_id, source, import_job_id%s) select $1, ''import'', $2%s from jsonb_populate_record(null::public.%I, $3) x',
                    v_table,
                    coalesce(', ' || (select string_agg(quote_ident(k), ', ') from unnest(v_keys) k), ''),
                    coalesce(', ' || (select string_agg('x.' || quote_ident(k), ', ') from unnest(v_keys) k), ''),
                    v_table);
    if p_mode = 'all_or_nothing' then
      execute v_sql using v_job.project_id, v_job.id, r;
      v_ok := v_ok + 1;
    else
      begin
        execute v_sql using v_job.project_id, v_job.id, r;
        v_ok := v_ok + 1;
      exception when others then
        get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', coalesce((r->>'_row')::int, i), 'error', v_msg, 'column', nullif(v_hint, '')));
      end;
    end if;
  end loop;

  update public.dc_import_jobs
     set status = 'committed', committed_rows = v_ok, committed_at = now(), mode = p_mode,
         error_rows = case when jsonb_array_length(v_errors) > 0 then coalesce(error_rows, '[]'::jsonb) || v_errors else error_rows end
   where id = p_job;
  return jsonb_build_object('committed', v_ok, 'errors', v_errors);
end;
$$;

-- grants: signed-in users only
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'dc\_%' loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on all functions in schema dc from public, anon;
grant execute on all functions in schema dc to authenticated, service_role;
