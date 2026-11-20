-- =====================================================================
-- Phase 3: evidence, checklist, verifier queries, import jobs, storage
-- =====================================================================

create table public.dc_evidence_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dc_projects(id) on delete cascade,
  pillar text references public.dc_pillars(code),
  title text not null,
  description text,
  required boolean not null default false,
  status text not null default 'outstanding' check (status in ('outstanding','uploaded','accepted','rejected')),
  sort int not null default 0,
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index dc_checklist_project_idx on public.dc_evidence_checklist_items (project_id, pillar);

create table public.dc_evidence_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dc_projects(id) on delete cascade,
  pillar text references public.dc_pillars(code),
  record_table text,
  record_id uuid,
  checklist_item_id uuid references public.dc_evidence_checklist_items(id) on delete set null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes <= 26214400),
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  check (record_table is null or record_table like 'dc\_%')
);
create index dc_evidence_project_idx on public.dc_evidence_files (project_id, pillar);
create index dc_evidence_record_idx on public.dc_evidence_files (record_table, record_id);
create index dc_evidence_checklist_idx on public.dc_evidence_files (checklist_item_id);

create table public.dc_record_queries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dc_projects(id) on delete cascade,
  record_table text not null check (record_table like 'dc\_%'),
  record_id uuid not null,
  body text not null,
  status text not null default 'open' check (status in ('open','answered','closed')),
  raised_by uuid default auth.uid(),
  raised_at timestamptz not null default now(),
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  closed_by uuid,
  closed_at timestamptz
);
create index dc_queries_project_idx on public.dc_record_queries (project_id, status);
create index dc_queries_record_idx on public.dc_record_queries (record_table, record_id);

create table public.dc_import_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dc_projects(id) on delete cascade,
  pillar text not null references public.dc_pillars(code),
  file_path text not null,
  file_name text,
  status text not null default 'uploaded' check (status in ('uploaded','validated','committed','failed')),
  column_map jsonb,
  total_rows int,
  valid_rows int,
  committed_rows int,
  error_rows jsonb,
  mode text check (mode in ('valid_only','all_or_nothing')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index dc_import_jobs_project_idx on public.dc_import_jobs (project_id, created_at desc);

-- ---------------------------------------------------------------------
-- guards
-- ---------------------------------------------------------------------
create or replace function dc.evidence_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if (select auth.uid()) is null then return new; end if;
  v_role := dc.project_role(new.project_id);
  if tg_op = 'INSERT' then
    if not dc.role_can(v_role, 'verify') then new.status := 'pending'; end if;
    new.uploaded_by := (select auth.uid());
    -- the file path must sit under this project's folder
    if new.storage_path not like '%/project/' || new.project_id::text || '/%' then
      raise exception 'Evidence path does not belong to this project' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not dc.role_can(v_role, 'verify') then
      raise exception 'Only a verifier or consultant can accept or reject evidence' using errcode = '42501';
    end if;
    new.reviewed_by := (select auth.uid()); new.reviewed_at := now();
  end if;
  if new.project_id <> old.project_id or new.storage_path <> old.storage_path then
    raise exception 'Evidence cannot be moved' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function dc.checklist_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if (select auth.uid()) is null then return new; end if;
  v_role := dc.project_role(new.project_id);
  if new.status is distinct from old.status and new.status in ('accepted','rejected')
     and not dc.role_can(v_role, 'verify') then
    raise exception 'Only a verifier or consultant can accept or reject checklist items' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('accepted','rejected') then
    new.reviewed_by := (select auth.uid()); new.reviewed_at := now();
  end if;
  return new;
end;
$$;

-- linking a file to a checklist item marks it uploaded
create or replace function dc.evidence_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.checklist_item_id is not null then
    update public.dc_evidence_checklist_items c set status = 'uploaded'
     where c.id = new.checklist_item_id and c.status in ('outstanding','rejected');
  end if;
  return new;
end;
$$;

create or replace function dc.query_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if (select auth.uid()) is null then return new; end if;
  v_role := dc.project_role(new.project_id);
  if tg_op = 'INSERT' then
    if not dc.role_can(v_role, 'verify') then
      raise exception 'Only a verifier or consultant can raise queries' using errcode = '42501';
    end if;
    new.raised_by := (select auth.uid()); new.status := 'open';
    return new;
  end if;
  if dc.role_can(v_role, 'verify') then
    if new.status = 'closed' and old.status <> 'closed' then new.closed_by := (select auth.uid()); new.closed_at := now(); end if;
    if new.answer is distinct from old.answer then new.answered_by := (select auth.uid()); new.answered_at := now(); end if;
    return new;
  end if;
  -- capture roles may only answer
  if (new.body, new.record_table, new.record_id, new.project_id) is distinct from (old.body, old.record_table, old.record_id, old.project_id)
     or new.status not in ('open','answered') or old.status = 'closed' then
    raise exception 'You can only answer an open query' using errcode = '42501';
  end if;
  if new.answer is distinct from old.answer then
    new.answered_by := (select auth.uid()); new.answered_at := now(); new.status := 'answered';
  end if;
  return new;
end;
$$;

create trigger dc_guard before insert or update on public.dc_evidence_files for each row execute function dc.evidence_guard();
create trigger dc_after after insert or update of checklist_item_id on public.dc_evidence_files for each row execute function dc.evidence_after();
create trigger dc_guard before update on public.dc_evidence_checklist_items for each row execute function dc.checklist_guard();
create trigger dc_guard before insert or update on public.dc_record_queries for each row execute function dc.query_guard();
create trigger dc_audit after insert or update or delete on public.dc_evidence_files for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_evidence_checklist_items for each row execute function dc.audit();
create trigger dc_audit after insert or update or delete on public.dc_record_queries for each row execute function dc.audit();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.dc_evidence_checklist_items enable row level security;
alter table public.dc_evidence_files enable row level security;
alter table public.dc_record_queries enable row level security;
alter table public.dc_import_jobs enable row level security;
revoke all on public.dc_evidence_checklist_items, public.dc_evidence_files, public.dc_record_queries, public.dc_import_jobs from anon;

create policy dc_read on public.dc_evidence_checklist_items for select to authenticated
  using (project_id in (select dc.my_projects('read')));
create policy dc_insert on public.dc_evidence_checklist_items for insert to authenticated
  with check (project_id in (select dc.my_projects('manage')));
create policy dc_update on public.dc_evidence_checklist_items for update to authenticated
  using (project_id in (select dc.my_projects('capture')) or project_id in (select dc.my_projects('verify')))
  with check (project_id in (select dc.my_projects('capture')) or project_id in (select dc.my_projects('verify')));
create policy dc_delete on public.dc_evidence_checklist_items for delete to authenticated
  using (project_id in (select dc.my_projects('manage')));

create policy dc_read on public.dc_evidence_files for select to authenticated
  using (project_id in (select dc.my_projects('read')));
create policy dc_insert on public.dc_evidence_files for insert to authenticated
  with check (project_id in (select dc.my_projects('capture'))
              and (pillar is null or project_id in (select dc.my_projects('manage')) or not dc.pillar_locked(project_id, pillar)));
create policy dc_update on public.dc_evidence_files for update to authenticated
  using (project_id in (select dc.my_projects('capture')) or project_id in (select dc.my_projects('verify')))
  with check (project_id in (select dc.my_projects('capture')) or project_id in (select dc.my_projects('verify')));
create policy dc_delete on public.dc_evidence_files for delete to authenticated
  using (project_id in (select dc.my_projects('manage'))
         or (project_id in (select dc.my_projects('capture')) and uploaded_by = (select auth.uid()) and status <> 'accepted'
             and (pillar is null or not dc.pillar_locked(project_id, pillar))));

create policy dc_read on public.dc_record_queries for select to authenticated
  using (project_id in (select dc.my_projects('read')));
create policy dc_insert on public.dc_record_queries for insert to authenticated
  with check (project_id in (select dc.my_projects('verify')));
create policy dc_update on public.dc_record_queries for update to authenticated
  using (project_id in (select dc.my_projects('capture')) or project_id in (select dc.my_projects('verify')))
  with check (project_id in (select dc.my_projects('capture')) or project_id in (select dc.my_projects('verify')));

create policy dc_read on public.dc_import_jobs for select to authenticated
  using (project_id in (select dc.my_projects('capture')));
create policy dc_write on public.dc_import_jobs for all to authenticated
  using (project_id in (select dc.my_projects('capture'))) with check (project_id in (select dc.my_projects('capture')));

-- ---------------------------------------------------------------------
-- Storage: private buckets, project id parsed from the path
--   dc-evidence: org/{org_id}/project/{project_id}/{pillar|general}/{uuid}-{filename}
--   dc-imports : project/{project_id}/{uuid}-{filename}
-- ---------------------------------------------------------------------
create or replace function dc.path_project(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when m[1] is not null then m[1]::uuid end
    from (select regexp_match(p_name, '(?:^|/)project/([0-9a-fA-F-]{36})/') m) x;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dc-evidence', 'dc-evidence', false, 26214400, array[
  'application/pdf','image/png','image/jpeg','image/gif','image/webp','image/tiff',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword',
  'application/zip','application/x-zip-compressed']),
  ('dc-imports', 'dc-imports', false, 26214400, array[
  'text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/octet-stream'])
on conflict (id) do nothing;

create policy dc_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'dc-evidence' and dc.path_project(name) in (select dc.my_projects('read_full')));
create policy dc_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dc-evidence' and dc.path_project(name) in (select dc.my_projects('capture')));
create policy dc_evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dc-evidence' and (dc.path_project(name) in (select dc.my_projects('manage'))
         or (owner_id = (select auth.uid())::text and dc.path_project(name) in (select dc.my_projects('capture')))));
create policy dc_imports_rw on storage.objects for select to authenticated
  using (bucket_id = 'dc-imports' and dc.path_project(name) in (select dc.my_projects('capture')));
create policy dc_imports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dc-imports' and dc.path_project(name) in (select dc.my_projects('capture')));

revoke execute on all functions in schema dc from public, anon;
grant execute on all functions in schema dc to authenticated, service_role;
