-- =====================================================================
-- DC repository – Phase 1 foundation
-- Lives inside the Mantis Hub Supabase project. All DC tables are
-- public.dc_* (so PostgREST exposes them without config changes) and
-- all helper functions live in the non-exposed `dc` schema.
-- Reuses: auth.users, public.organisations, private.is_super_admin().
-- This migration only ADDS objects; nothing in Mantis Hub is altered.
-- =====================================================================

create schema if not exists dc;
grant usage on schema dc to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------
create table public.dc_pillars (
  code text primary key,
  label text not null,
  table_name text not null unique,
  criteria_key text,
  mode text not null check (mode in ('single','list')),
  sort int not null default 0
);

create table public.dc_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true
);

create table public.dc_sector_codes (
  code text primary key,
  name text not null,
  active boolean not null default true
);

create table public.dc_lookups (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  code text not null,
  label text not null,
  sort int not null default 0,
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  unique (type, code)
);

create table public.dc_field_defs (
  id uuid primary key default gen_random_uuid(),
  pillar text not null references public.dc_pillars(code),
  key text not null,
  label text not null,
  data_type text not null check (data_type in ('money','money_signed','percent','integer','numeric','boolean','text','date','lookup','enum','fk')),
  lookup_type text,
  enum_values text[],
  enum_labels text[],
  fk_target text check (fk_target in ('people','beneficiaries','suppliers','divisions')),
  min_value numeric,
  max_value numeric,
  required boolean not null default false,
  is_criteria boolean not null default false,
  sensitive boolean not null default false,
  help text,
  sort int not null default 0,
  grid_visible boolean not null default true,
  group_name text,
  legacy_labels text[] not null default '{}',
  unique (pillar, key)
);

create table public.dc_field_rules (
  id uuid primary key default gen_random_uuid(),
  pillar text not null references public.dc_pillars(code),
  key text not null,
  criteria_key text,
  criteria_value text,
  sector_code text references public.dc_sector_codes(code),
  visible boolean not null default true,
  required boolean,
  label_override text,
  note text
);
create index dc_field_rules_pillar_idx on public.dc_field_rules (pillar, key);

create table public.dc_evidence_templates (
  id uuid primary key default gen_random_uuid(),
  sector_code text references public.dc_sector_codes(code),
  pillar text references public.dc_pillars(code),
  title text not null,
  description text,
  required boolean not null default false,
  sort int not null default 0
);

-- ---------------------------------------------------------------------
-- Tenancy (organisations come from Mantis Hub: public.organisations)
-- ---------------------------------------------------------------------
create table public.dc_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.dc_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  updated_at timestamptz not null default now()
);

create table public.dc_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  role text not null check (role in ('consultant','client_editor','client_viewer')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (user_id, org_id)
);
create index dc_memberships_org_idx on public.dc_memberships (org_id);

create table public.dc_org_divisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- ---------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------
create table public.dc_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete restrict,
  division_id uuid references public.dc_org_divisions(id) on delete set null,
  product_id uuid not null references public.dc_products(id),
  sector_code text not null references public.dc_sector_codes(code),
  size text not null check (size in ('EME','QSE','GENERIC')),
  title text not null,
  fy_end date not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','capturing','in_verification','verified','archived')),
  data_deadline date,
  verification_date date,
  description text,
  previous_project_id uuid references public.dc_projects(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (period_start <= period_end)
);
create index dc_projects_org_idx on public.dc_projects (org_id);
create index dc_projects_division_idx on public.dc_projects (division_id);
create index dc_projects_prev_idx on public.dc_projects (previous_project_id);

create table public.dc_project_members (
  project_id uuid not null references public.dc_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('consultant','client_editor','client_viewer','verifier')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index dc_project_members_user_idx on public.dc_project_members (user_id);

create table public.dc_pillar_status (
  project_id uuid not null references public.dc_projects(id) on delete cascade,
  pillar text not null references public.dc_pillars(code),
  locked boolean not null default false,
  locked_by uuid,
  locked_at timestamptz,
  primary key (project_id, pillar)
);

-- ---------------------------------------------------------------------
-- Shared masters (per organisation)
-- ---------------------------------------------------------------------
create table public.dc_people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  surname text not null,
  first_name text not null,
  id_number text,
  race_lookup uuid references public.dc_lookups(id),
  gender_lookup uuid references public.dc_lookups(id),
  nationality_lookup uuid references public.dc_lookups(id),
  disabled boolean not null default false,
  disability_detail text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index dc_people_org_idx on public.dc_people (org_id);
create unique index dc_people_org_id_number_uq on public.dc_people (org_id, id_number) where id_number is not null;
create index dc_people_name_idx on public.dc_people (org_id, lower(surname), lower(first_name));

create table public.dc_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  reg_no text,
  black_owned_pct numeric(7,4) check (black_owned_pct between 0 and 100),
  bwo_pct numeric(7,4) check (bwo_pct between 0 and 100),
  classification text check (classification in ('EME','QSE','GEN')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index dc_beneficiaries_org_idx on public.dc_beneficiaries (org_id, lower(name));

create table public.dc_suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  vendor_number text,
  name text not null,
  reg_no text,
  vat_no text,
  contact_person text,
  tel text,
  email text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index dc_suppliers_org_idx on public.dc_suppliers (org_id, lower(name));
create unique index dc_suppliers_vendor_uq on public.dc_suppliers (org_id, vendor_number) where vendor_number is not null;

-- ---------------------------------------------------------------------
-- Audit log (DC only; Mantis Hub keeps its own public.audit_log)
-- ---------------------------------------------------------------------
create table public.dc_audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  project_id uuid,
  org_id uuid,
  action text not null,
  old jsonb,
  new jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index dc_audit_project_idx on public.dc_audit_log (project_id, changed_at desc);
create index dc_audit_record_idx on public.dc_audit_log (table_name, record_id);
create index dc_audit_org_idx on public.dc_audit_log (org_id);

-- =====================================================================
-- Helper functions (schema dc, not exposed through the API)
-- =====================================================================

create or replace function dc.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_super_admin(), false)
      or exists (select 1 from public.dc_admins a where a.user_id = (select auth.uid()));
$$;

-- capability matrix (section 5 of the build prompt)
--   read      every role
--   read_full every role except client_viewer (unmasked ID numbers / salaries)
--   capture   mantis_admin, consultant, client_editor
--   manage    mantis_admin, consultant
--   verify    mantis_admin, consultant, verifier
--   admin     mantis_admin
create or replace function dc.role_can(p_role text, p_cap text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_cap
    when 'read'      then p_role is not null
    when 'read_full' then p_role in ('mantis_admin','consultant','client_editor','verifier')
    when 'capture'   then p_role in ('mantis_admin','consultant','client_editor')
    when 'manage'    then p_role in ('mantis_admin','consultant')
    when 'verify'    then p_role in ('mantis_admin','consultant','verifier')
    when 'admin'     then p_role = 'mantis_admin'
    else false end;
$$;

-- every project the caller can reach with a capability (set-returning so RLS evaluates it once)
create or replace function dc.my_projects(p_cap text)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if dc.is_admin() then
    return query select p.id from public.dc_projects p;
    return;
  end if;
  return query
    select pm.project_id from public.dc_project_members pm
     where pm.user_id = (select auth.uid()) and dc.role_can(pm.role, p_cap)
    union
    select p.id from public.dc_projects p
      join public.dc_memberships m on m.org_id = p.org_id
     where m.user_id = (select auth.uid()) and dc.role_can(m.role, p_cap);
end;
$$;

-- every organisation the caller can reach with a capability
create or replace function dc.my_orgs(p_cap text)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if dc.is_admin() then
    return query select o.id from public.organisations o where o.deleted_at is null;
    return;
  end if;
  return query
    select m.org_id from public.dc_memberships m
     where m.user_id = (select auth.uid()) and dc.role_can(m.role, p_cap)
    union
    select p.org_id from public.dc_project_members pm join public.dc_projects p on p.id = pm.project_id
     where pm.user_id = (select auth.uid()) and dc.role_can(pm.role, p_cap);
end;
$$;

create or replace function dc.has_project_access(p_project uuid, p_cap text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from dc.my_projects(p_cap) x where x = p_project);
$$;

create or replace function dc.has_org_access(p_org uuid, p_cap text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from dc.my_orgs(p_cap) x where x = p_org);
$$;

-- highest effective role on a project (for UI and guards)
create or replace function dc.project_role(p_project uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when dc.is_admin() then 'mantis_admin'
    else (
      select r from (
        select pm.role as r from public.dc_project_members pm
         where pm.project_id = p_project and pm.user_id = (select auth.uid())
        union all
        select m.role from public.dc_memberships m join public.dc_projects p on p.org_id = m.org_id
         where p.id = p_project and m.user_id = (select auth.uid())
      ) x
      order by array_position(array['consultant','client_editor','verifier','client_viewer'], r)
      limit 1)
  end;
$$;

create or replace function dc.pillar_locked(p_project uuid, p_pillar text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ps.locked from public.dc_pillar_status ps
                    where ps.project_id = p_project and ps.pillar = p_pillar), false);
$$;

-- South African ID number: 13 digits + Luhn check digit
create or replace function dc.sa_id_valid(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare s int := 0; d int; i int;
begin
  if p is null or p !~ '^[0-9]{13}$' then return false; end if;
  for i in 1..13 loop
    d := substr(p, 14 - i, 1)::int;
    if i % 2 = 0 then d := d * 2; if d > 9 then d := d - 9; end if; end if;
    s := s + d;
  end loop;
  return s % 10 = 0;
end;
$$;

-- date of birth from an SA ID (century guessed relative to today)
create or replace function dc.sa_id_dob(p text)
returns date language plpgsql stable set search_path = '' as $$
declare yy int; y int; d date;
begin
  if p is null or p !~ '^[0-9]{6}' then return null; end if;
  yy := substr(p,1,2)::int;
  y := case when 2000 + yy <= extract(year from now())::int then 2000 + yy else 1900 + yy end;
  begin
    d := make_date(y, substr(p,3,2)::int, substr(p,5,2)::int);
  exception when others then return null;
  end;
  return d;
end;
$$;

-- updated_at / updated_by
create or replace function dc.touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

-- generic audit trigger. POPIA: ID numbers and salaries are never written to the log.
create or replace function dc.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ro jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  rn jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  o jsonb := ro;
  n jsonb := rn;
  k text;
  r jsonb := coalesce(rn, ro);
  v_project uuid;
  v_org uuid;
begin
  -- for updates only keep the changed keys
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(e.key, e.value) into n
      from jsonb_each(rn) e
     where (ro->e.key) is distinct from e.value
       and e.key not in ('updated_at','updated_by');
    if n is null then return new; end if;
    select jsonb_object_agg(e.key, e.value) into o from jsonb_each(ro) e where n ? e.key;
  end if;
  -- POPIA: redact sensitive keys, keeping only a marker that they were set / changed
  foreach k in array array['id_number','monthly_salary','monthly_stipend'] loop
    if o is not null and o ? k then
      o := o || jsonb_build_object(k, case when o->>k is null then null else '***' end);
    end if;
    if n is not null and n ? k then
      n := n || jsonb_build_object(k, case when n->>k is null then null
                                           when tg_op = 'UPDATE' then '***changed***' else '***' end);
    end if;
  end loop;
  if tg_table_name = 'dc_projects' then v_project := (r->>'id')::uuid;
  else v_project := nullif(r->>'project_id','')::uuid; end if;
  v_org := nullif(r->>'org_id','')::uuid;
  if v_org is null and v_project is not null then
    select p.org_id into v_org from public.dc_projects p where p.id = v_project;
  end if;
  insert into public.dc_audit_log (table_name, record_id, project_id, org_id, action, old, new, changed_by)
  values (tg_table_name,
          case when r ? 'id' and (r->>'id') ~ '^[0-9a-f-]{36}$' then (r->>'id')::uuid end,
          v_project, v_org, lower(tg_op), o, n, (select auth.uid()));
  return coalesce(new, old);
end;
$$;

-- people: SA ID checksum unless the person is a foreign national
create or replace function dc.people_validate()
returns trigger language plpgsql set search_path = '' as $$
declare v_nat text;
begin
  new.id_number := nullif(regexp_replace(coalesce(new.id_number,''), '\s', '', 'g'), '');
  if new.id_number is not null then
    select l.code into v_nat from public.dc_lookups l where l.id = new.nationality_lookup;
    if coalesce(v_nat,'SA') <> 'FN' and not dc.sa_id_valid(new.id_number) then
      raise exception 'Invalid South African ID number for % %', new.first_name, new.surname
        using errcode = '23514', hint = 'id_number';
    end if;
  end if;
  return new;
end;
$$;

create trigger dc_people_validate before insert or update on public.dc_people
  for each row execute function dc.people_validate();

-- touch + audit triggers on foundation tables
create trigger dc_touch before update on public.dc_projects for each row execute function dc.touch();
create trigger dc_touch before update on public.dc_people for each row execute function dc.touch();
create trigger dc_touch before update on public.dc_beneficiaries for each row execute function dc.touch();
create trigger dc_touch before update on public.dc_suppliers for each row execute function dc.touch();

create trigger dc_audit after insert or update or delete on public.dc_projects for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_people for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_beneficiaries for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_suppliers for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_project_members for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_pillar_status for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_memberships for each row execute function dc.audit();

-- =====================================================================
-- Row level security
-- =====================================================================
alter table public.dc_pillars enable row level security;
alter table public.dc_products enable row level security;
alter table public.dc_sector_codes enable row level security;
alter table public.dc_lookups enable row level security;
alter table public.dc_field_defs enable row level security;
alter table public.dc_field_rules enable row level security;
alter table public.dc_evidence_templates enable row level security;
alter table public.dc_admins enable row level security;
alter table public.dc_profiles enable row level security;
alter table public.dc_memberships enable row level security;
alter table public.dc_org_divisions enable row level security;
alter table public.dc_projects enable row level security;
alter table public.dc_project_members enable row level security;
alter table public.dc_pillar_status enable row level security;
alter table public.dc_people enable row level security;
alter table public.dc_beneficiaries enable row level security;
alter table public.dc_suppliers enable row level security;
alter table public.dc_audit_log enable row level security;

-- config: everyone signed in reads, mantis_admin writes
do $$
declare t text;
begin
  foreach t in array array['dc_pillars','dc_products','dc_sector_codes','dc_lookups','dc_field_defs','dc_field_rules','dc_evidence_templates'] loop
    execute format('create policy dc_read on public.%I for select to authenticated using (true)', t);
    execute format('create policy dc_admin_write on public.%I for all to authenticated using ((select dc.is_admin())) with check ((select dc.is_admin()))', t);
  end loop;
end $$;

create policy dc_read on public.dc_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select dc.is_admin()));
create policy dc_admin_write on public.dc_admins for all to authenticated
  using ((select dc.is_admin())) with check ((select dc.is_admin()));

create policy dc_read on public.dc_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select dc.is_admin()));
create policy dc_own_write on public.dc_profiles for all to authenticated
  using (user_id = (select auth.uid()) or (select dc.is_admin()))
  with check (user_id = (select auth.uid()) or (select dc.is_admin()));

create policy dc_read on public.dc_memberships for select to authenticated
  using (user_id = (select auth.uid()) or org_id in (select dc.my_orgs('manage')));
create policy dc_admin_write on public.dc_memberships for all to authenticated
  using ((select dc.is_admin())) with check ((select dc.is_admin()));

create policy dc_read on public.dc_org_divisions for select to authenticated
  using (org_id in (select dc.my_orgs('read')));
create policy dc_manage on public.dc_org_divisions for all to authenticated
  using (org_id in (select dc.my_orgs('manage'))) with check (org_id in (select dc.my_orgs('manage')));

create policy dc_read on public.dc_projects for select to authenticated
  using (id in (select dc.my_projects('read')));
create policy dc_update on public.dc_projects for update to authenticated
  using (id in (select dc.my_projects('manage'))) with check (id in (select dc.my_projects('manage')));
create policy dc_delete on public.dc_projects for delete to authenticated
  using ((select dc.is_admin()));
-- inserts go through public.dc_create_project()

create policy dc_read on public.dc_project_members for select to authenticated
  using (project_id in (select dc.my_projects('read')));
create policy dc_manage on public.dc_project_members for all to authenticated
  using (project_id in (select dc.my_projects('manage'))) with check (project_id in (select dc.my_projects('manage')));

create policy dc_read on public.dc_pillar_status for select to authenticated
  using (project_id in (select dc.my_projects('read')));
-- writes go through public.dc_set_pillar_lock()

-- masters: unmasked read for every role except client_viewer (viewers use dc_v_people_masked)
do $$
declare t text;
begin
  foreach t in array array['dc_people','dc_beneficiaries','dc_suppliers'] loop
    execute format('create policy dc_read on public.%I for select to authenticated using (org_id in (select dc.my_orgs(''read_full'')))', t);
    execute format('create policy dc_insert on public.%I for insert to authenticated with check (org_id in (select dc.my_orgs(''capture'')))', t);
    execute format('create policy dc_update on public.%I for update to authenticated using (org_id in (select dc.my_orgs(''capture''))) with check (org_id in (select dc.my_orgs(''capture'')))', t);
    execute format('create policy dc_delete on public.%I for delete to authenticated using (org_id in (select dc.my_orgs(''manage'')))', t);
  end loop;
end $$;

-- viewers (and everyone else) can read masked people: ID shows last 4 characters only
create or replace function dc.people_masked()
returns table (id uuid, org_id uuid, surname text, first_name text, id_number_masked text,
               race_lookup uuid, gender_lookup uuid, nationality_lookup uuid, disabled boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.org_id, p.surname, p.first_name,
         case when p.id_number is null then null else '*********' || right(p.id_number, 4) end,
         p.race_lookup, p.gender_lookup, p.nationality_lookup, p.disabled
    from public.dc_people p
   where p.org_id in (select dc.my_orgs('read'));
$$;
create view public.dc_v_people_masked with (security_invoker = on) as
  select * from dc.people_masked();

create policy dc_read on public.dc_audit_log for select to authenticated
  using (
    (project_id is not null and project_id in (select dc.my_projects('read_full')))
    or (project_id is null and org_id in (select dc.my_orgs('read_full')))
    or (select dc.is_admin())
  );

-- privileges: nothing for anon, functions only for signed-in users
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'dc\_%' loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
revoke all on public.dc_v_people_masked from anon;
grant select on public.dc_v_people_masked to authenticated;
revoke execute on all functions in schema dc from public, anon;
grant execute on all functions in schema dc to authenticated, service_role;
