-- =====================================================================
-- DC gate tests (Gates 1–3, database level).
-- Safe to run against the live Mantis Hub database: everything happens
-- inside one DO block that ALWAYS ends by raising an exception, so all
-- test users, organisations and rows are rolled back. The exception
-- message is the test report ("PASS n / FAIL n" + details).
--
-- Run: psql -f supabase/tests/dc_gate_tests.sql   (or paste into the SQL editor)
-- =====================================================================

create or replace function pg_temp.act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  if p_uid is not null then
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  else
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

-- scalar query as a user
create or replace function pg_temp.q(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.act(p_uid);
  execute p_sql into v;
  perform pg_temp.act(null);
  return v;
exception when others then
  perform pg_temp.act(null);
  return 'ERROR: ' || sqlerrm;
end $$;

-- statement as a user; returns null on success or the error message
create or replace function pg_temp.x(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.act(p_uid);
  execute p_sql;
  perform pg_temp.act(null);
  return null;
exception when others then
  perform pg_temp.act(null);
  return sqlerrm;
end $$;

do $test$
declare
  -- users
  ua uuid := '00000000-0000-4000-a000-00000000000a';  -- mantis_admin
  uc uuid := '00000000-0000-4000-a000-00000000000c';  -- consultant O1
  ue uuid := '00000000-0000-4000-a000-00000000000e';  -- client_editor O1
  uv uuid := '00000000-0000-4000-a000-000000000001';  -- client_viewer O1
  ur uuid := '00000000-0000-4000-a000-000000000002';  -- verifier on P1 only
  ux uuid := '00000000-0000-4000-a000-000000000003';  -- client_editor O2 (outsider)
  o1 uuid; o2 uuid; p1 uuid; p2 uuid; p3 uuid;
  v_person uuid; v_row uuid; v_row2 uuid; v_q uuid; v_ev uuid; v_ci uuid; v_job uuid;
  v_lk_ol uuid; v_lk_cat uuid; v_lk_level uuid; v_sup uuid;
  r text;
  pass int := 0; fail int := 0; report text := '';
  -- assertion helper (inline)
  procedure_dummy int;
begin
  -- --------------------------------------------------------------- setup (as owner)
  insert into auth.users (id, email) values
    (ua, 'dc-test-admin@example.invalid'), (uc, 'dc-test-consultant@example.invalid'), (ue, 'dc-test-editor@example.invalid'),
    (uv, 'dc-test-viewer@example.invalid'), (ur, 'dc-test-verifier@example.invalid'), (ux, 'dc-test-outsider@example.invalid');
  insert into public.organisations (name, org_type) values ('ZZ DC Test Org 1', 'client') returning id into o1;
  insert into public.organisations (name, org_type) values ('ZZ DC Test Org 2', 'client') returning id into o2;
  insert into public.dc_admins (user_id) values (ua);
  insert into public.dc_memberships (user_id, org_id, role) values
    (uc, o1, 'consultant'), (ue, o1, 'client_editor'), (uv, o1, 'client_viewer'), (ux, o2, 'client_editor');
  select id into v_lk_ol from public.dc_lookups where type = 'occupational_level' and code = 'OL3';
  select id into v_lk_cat from public.dc_lookups where type = 'learning_category' and code = 'A';
  select id into v_lk_level from public.dc_lookups where type = 'bee_level_proc' and code = '1';

  -- consultant creates P1 through the wizard RPC, with the verifier as a project member
  r := pg_temp.q(uc, format($$select public.dc_create_project('{"org_id":"%s","fy_end":"2026-02-28","sector_code":"DTI","size":"GENERIC","members":[{"user_id":"%s","role":"verifier"}]}'::jsonb)$$, o1, ur));
  p1 := case when r like 'ERROR%' then null else r::uuid end;
  r := pg_temp.q(ua, format($$select public.dc_create_project('{"org_id":"%s","fy_end":"2026-06-30","sector_code":"ICT","size":"QSE"}'::jsonb)$$, o2));
  p2 := case when r like 'ERROR%' then null else r::uuid end;

  -- helper: record results
  create temp table if not exists _t (n serial, name text, ok boolean, detail text) on commit drop;

  insert into _t (name, ok, detail) values ('G1 consultant can create project (wizard)', p1 is not null, r);
  insert into _t (name, ok, detail) values ('G1 admin can create project in any org', p2 is not null, null);
  insert into _t (name, ok, detail) select 'G1 wizard creates 8 pillar_status rows', count(*) = 8, count(*)::text from public.dc_pillar_status where project_id = p1;
  insert into _t (name, ok, detail) select 'G1 wizard generates evidence checklist', count(*) >= 15, count(*)::text from public.dc_evidence_checklist_items where project_id = p1;
  insert into _t (name, ok, detail) select 'G1 wizard derives period + label', period_start = '2025-03-01' and period_end = '2026-02-28' and title = 'FY2026 (Mar 2025–Feb 2026)', title from public.dc_projects where id = p1;

  -- --------------------------------------------------------------- project visibility per role
  insert into _t (name, ok, detail) values
    ('G1 admin sees P1 and P2', pg_temp.q(ua, format('select count(*) from public.dc_projects where id in (%L,%L)', p1, p2)) = '2', null),
    ('G1 consultant sees P1 only', pg_temp.q(uc, format('select count(*) from public.dc_projects where id in (%L,%L)', p1, p2)) = '1', null),
    ('G1 editor sees P1 only', pg_temp.q(ue, format('select count(*) from public.dc_projects where id in (%L,%L)', p1, p2)) = '1', null),
    ('G1 viewer sees P1 only', pg_temp.q(uv, format('select count(*) from public.dc_projects where id in (%L,%L)', p1, p2)) = '1', null),
    ('G1 verifier sees P1 only', pg_temp.q(ur, format('select count(*) from public.dc_projects where id in (%L,%L)', p1, p2)) = '1', null),
    ('G1 outsider sees P2 only', pg_temp.q(ux, format('select string_agg(id::text, '','') from public.dc_projects where id in (%L,%L)', p1, p2)) = p2::text, null),
    ('G1 nobody signed in sees nothing', pg_temp.q(null, format('set local role anon; select count(*) from public.dc_projects where id = %L', p1)) is distinct from '1', null);

  insert into _t (name, ok, detail) values
    ('G1 consultant can edit project', pg_temp.q(uc, format($$with u as (update public.dc_projects set description = 'x' where id = %L returning 1) select count(*) from u$$, p1)) = '1', null),
    ('G1 editor cannot edit project', pg_temp.q(ue, format($$with u as (update public.dc_projects set description = 'y' where id = %L returning 1) select count(*) from u$$, p1)) = '0', null),
    ('G1 editor cannot create project', pg_temp.q(ue, format($$select public.dc_create_project('{"org_id":"%s","fy_end":"2026-02-28"}'::jsonb)$$, o1)) like 'ERROR%', null),
    ('G1 outsider cannot create project in O1', pg_temp.q(ux, format($$select public.dc_create_project('{"org_id":"%s","fy_end":"2026-02-28"}'::jsonb)$$, o1)) like 'ERROR%', null);

  -- --------------------------------------------------------------- masters
  r := pg_temp.q(ue, format($$insert into public.dc_people (org_id, surname, first_name, id_number) values (%L, 'Mokoena', 'Thabo', '9001015009086') returning id$$, o1));
  v_person := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values ('G1 editor can add a person (valid SA ID)', v_person is not null, r);
  insert into _t (name, ok, detail) values
    ('G1 invalid SA ID checksum rejected', pg_temp.x(ue, format($$insert into public.dc_people (org_id, surname, first_name, id_number) values (%L, 'Bad', 'Id', '9001015009087')$$, o1)) like '%Invalid South African ID%', null),
    ('G1 outsider cannot add person to O1', pg_temp.x(ux, format($$insert into public.dc_people (org_id, surname, first_name) values (%L, 'X', 'Y')$$, o1)) is not null, null),
    ('G1 outsider cannot read O1 people', pg_temp.q(ux, format('select count(*) from public.dc_people where org_id = %L', o1)) = '0', null),
    ('G1 viewer cannot read unmasked people', pg_temp.q(uv, format('select count(*) from public.dc_people where org_id = %L', o1)) = '0', null),
    ('G1 viewer sees masked ID (last 4 only)', pg_temp.q(uv, format('select id_number_masked from public.dc_v_people_masked where id = %L', v_person)) = '*********9086', null),
    ('G1 verifier can read people of its project org', pg_temp.q(ur, format('select count(*) from public.dc_people where id = %L', v_person)) = '1', null);
  r := pg_temp.q(ue, format($$insert into public.dc_suppliers (org_id, vendor_number, name) values (%L, 'V001', 'Acme Supplies') returning id$$, o1));
  v_sup := case when r like 'ERROR%' then null else r::uuid end;

  -- --------------------------------------------------------------- capture rows
  r := pg_temp.q(ue, format($$insert into public.dc_mc_members (project_id, person_id, occupational_level) values (%L, %L, %L) returning id$$, p1, v_person, v_lk_ol));
  v_row := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values ('G2 editor can capture MC row', v_row is not null, r);
  insert into _t (name, ok, detail) values
    ('G2 required field enforced in DB (MC without person)', pg_temp.x(ue, format($$insert into public.dc_mc_members (project_id, occupational_level) values (%L, %L)$$, p1, v_lk_ol)) like 'Required field missing: Employee%', null),
    ('G2 conditional required (indicative margin)', pg_temp.x(ue, format($$update public.dc_fin_sheet set npat_basis = 'indicative_margin' where project_id = %L$$, p1)) like 'Required field missing: Indicative%', null),
    ('G2 conditional required satisfied', pg_temp.x(ue, format($$update public.dc_fin_sheet set npat_basis = 'indicative_margin', indicative_margin_pct = 12.5, turnover = 1000000 where project_id = %L$$, p1)) is null, null),
    ('G2 learnerships limited to categories B–D', pg_temp.x(ue, format($$insert into public.dc_sd_interventions (project_id, criteria, person_id, learning_category) values (%L, 'sd_learners', %L, %L)$$, p1, v_person, v_lk_cat)) like '%category B, C or D%', null),
    ('G2 SD formal row accepted', pg_temp.x(ue, format($$insert into public.dc_sd_interventions (project_id, criteria, person_id, learning_category, course_cost, monthly_stipend) values (%L, 'sd_spend_formal', %L, %L, 5000, 4500)$$, p1, v_person, v_lk_cat)) is null, null),
    ('G2 payment date before invoice date rejected', pg_temp.x(ue, format($$insert into public.dc_esd_contributions (project_id, esd_category, supplier_id, invoice_number, invoice_amount, invoice_date, payment_date) values (%L, 'sd_early_payment', %L, 'INV1', 100, '2025-05-10', '2025-05-01')$$, p1, v_sup)) is not null, null),
    ('G2 early payment row accepted + days_to_pay', pg_temp.q(ue, format($$insert into public.dc_esd_contributions (project_id, esd_category, supplier_id, invoice_number, invoice_amount, invoice_date, payment_date) values (%L, 'sd_early_payment', %L, 'INV2', 100, '2025-05-01', '2025-05-11') returning days_to_pay$$, p1, v_sup)) = '10', null),
    ('G2 bw_pct > black_pct rejected', pg_temp.x(ue, format($$insert into public.dc_own_shareholders (project_id, category, name, black_pct, bw_pct) values (%L, 'organisation', 'HoldCo', 30, 40)$$, p1)) is not null, null),
    ('G2 procurement row accepted', pg_temp.x(ue, format($$insert into public.dc_proc_suppliers (project_id, supplier_id, annual_spend_excl_vat, bee_level) values (%L, %L, 250000, %L)$$, p1, v_sup, v_lk_level)) is null, null),
    ('G2 viewer cannot capture', pg_temp.x(uv, format($$insert into public.dc_own_shareholders (project_id, category, name) values (%L, 'individual', 'V')$$, p1)) is not null, null),
    ('G2 verifier cannot capture', pg_temp.x(ur, format($$insert into public.dc_own_shareholders (project_id, category, name) values (%L, 'individual', 'R')$$, p1)) is not null, null),
    ('G2 verifier cannot edit data (0 rows)', pg_temp.q(ur, format($$with u as (update public.dc_mc_members set position = 'hack' where id = %L returning 1) select count(*) from u$$, v_row)) = '0', null),
    ('G2 outsider cannot read P1 rows', pg_temp.q(ux, format('select count(*) from public.dc_mc_members where project_id = %L', p1)) = '0', null),
    ('G2 outsider cannot write P1 rows', pg_temp.x(ux, format($$insert into public.dc_own_shareholders (project_id, category, name) values (%L, 'individual', 'X')$$, p1)) is not null, null),
    ('G2 editor cannot self-verify a row', pg_temp.x(ue, format($$update public.dc_mc_members set verification_status = 'verified' where id = %L$$, v_row)) is not null, null),
    ('G2 viewer grid via RPC hides stipend', pg_temp.q(uv, format($$select (public.dc_list_rows(%L, 'dc_sd_interventions')->'rows'->0) ? 'monthly_stipend'$$, p1)) = 'false', null),
    ('G2 editor grid via RPC shows stipend', pg_temp.q(ue, format($$select (public.dc_list_rows(%L, 'dc_sd_interventions')->'rows'->0->>'monthly_stipend')$$, p1)) = '4500.00', null),
    ('G2 outsider list_rows refused', pg_temp.q(ux, format($$select public.dc_list_rows(%L, 'dc_mc_members')$$, p1)) like 'ERROR%', null),
    ('G2 dashboard returns 8 pillars', pg_temp.q(ue, format($$select jsonb_array_length(public.dc_project_dashboard(%L)->'pillars')$$, p1)) = '8', null);

  -- --------------------------------------------------------------- locking
  insert into _t (name, ok, detail) values
    ('G3 editor cannot lock a pillar', pg_temp.x(ue, format($$select public.dc_set_pillar_lock(%L, 'ownership', true)$$, p1)) is not null, null),
    ('G3 consultant locks ownership', pg_temp.x(uc, format($$select public.dc_set_pillar_lock(%L, 'ownership', true)$$, p1)) is null, null),
    ('G3 editor blocked on locked pillar', pg_temp.x(ue, format($$insert into public.dc_own_shareholders (project_id, category, name) values (%L, 'individual', 'Late')$$, p1)) is not null, null),
    ('G3 consultant can still write locked pillar', pg_temp.x(uc, format($$insert into public.dc_own_shareholders (project_id, category, name, black_person) values (%L, 'individual', 'Zanele Dlamini', true)$$, p1)) is null, null),
    ('G3 other pillars stay open for editor', pg_temp.x(ue, format($$insert into public.dc_mc_members (project_id, person_id, occupational_level, position) values (%L, %L, %L, 'CFO')$$, p1, v_person, v_lk_ol)) is null, null),
    ('G3 consultant unlocks ownership', pg_temp.x(uc, format($$select public.dc_set_pillar_lock(%L, 'ownership', false)$$, p1)) is null, null);

  -- --------------------------------------------------------------- sampling, queries, verification
  insert into _t (name, ok, detail) values
    ('G3 verifier samples a row', pg_temp.q(ur, format($$select public.dc_set_sample(%L, 'dc_mc_members', array[%L]::uuid[], true)$$, p1, v_row)) = '1', null);
  insert into _t (name, ok, detail) values
    ('G3 sampled row status = sampled', (select verification_status = 'sampled' from public.dc_mc_members where id = v_row), null);
  insert into _t (name, ok, detail) values
    ('G3 editor cannot sample', pg_temp.q(ue, format($$select public.dc_set_sample(%L, 'dc_mc_members', array[%L]::uuid[], true)$$, p1, v_row)) like 'ERROR%', null),
    ('G3 verifier random sample n=2', pg_temp.q(ur, format($$select public.dc_random_sample(%L, 'management_control', 2)$$, p1)) = '1', null);
  r := pg_temp.q(ur, format($$select public.dc_raise_query(%L, 'dc_mc_members', %L, 'Please upload the appointment letter')$$, p1, v_row));
  v_q := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values ('G3 verifier raises query', v_q is not null, r);
  insert into _t (name, ok, detail) values
    ('G3 row becomes queried', (select verification_status = 'queried' from public.dc_mc_members where id = v_row), null),
    ('G3 editor cannot raise query', pg_temp.q(ue, format($$select public.dc_raise_query(%L, 'dc_mc_members', %L, 'x')$$, p1, v_row)) like 'ERROR%', null),
    ('G3 editor answers query', pg_temp.x(ue, format($$update public.dc_record_queries set answer = 'Uploaded' where id = %L$$, v_q)) is null, null);
  insert into _t (name, ok, detail) values
    ('G3 answered status set', (select status = 'answered' from public.dc_record_queries where id = v_q), null);
  insert into _t (name, ok, detail) values
    ('G3 editor cannot close query', pg_temp.x(ue, format($$update public.dc_record_queries set status = 'closed' where id = %L$$, v_q)) is not null, null),
    ('G3 verifier closes query', pg_temp.x(ur, format($$update public.dc_record_queries set status = 'closed' where id = %L$$, v_q)) is null, null),
    ('G3 verifier verifies row', pg_temp.q(ur, format($$select public.dc_set_verification(%L, 'dc_mc_members', array[%L]::uuid[], 'verified')$$, p1, v_row)) = '1', null),
    ('G3 consultant locks rows', pg_temp.q(uc, format($$select public.dc_set_row_lock(%L, 'dc_mc_members', array[%L]::uuid[], true)$$, p1, v_row)) = '1', null),
    ('G3 editor cannot edit locked row (0 rows)', pg_temp.q(ue, format($$with u as (update public.dc_mc_members set position = 'z' where id = %L returning 1) select count(*) from u$$, v_row)) = '0', null);

  -- --------------------------------------------------------------- evidence
  select id into v_ci from public.dc_evidence_checklist_items where project_id = p1 and pillar = 'management_control' order by sort limit 1;
  r := pg_temp.q(ue, format($$insert into public.dc_evidence_files (project_id, pillar, checklist_item_id, record_table, record_id, storage_path, file_name, mime_type, size_bytes)
                               values (%L, 'management_control', %L, 'dc_mc_members', %L, %L, 'org.pdf', 'application/pdf', 1000) returning id$$,
                               p1, v_ci, v_row, 'org/' || o1 || '/project/' || p1 || '/management_control/' || gen_random_uuid() || '-org.pdf'));
  v_ev := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values ('G3 editor uploads evidence record', v_ev is not null, r);
  insert into _t (name, ok, detail) values
    ('G3 checklist item marked uploaded', (select status = 'uploaded' from public.dc_evidence_checklist_items where id = v_ci), null),
    ('G3 evidence path must match project', pg_temp.x(ue, format($$insert into public.dc_evidence_files (project_id, storage_path, file_name) values (%L, %L, 'x.pdf')$$, p1, 'org/' || o2 || '/project/' || p2 || '/general/x.pdf')) is not null, null),
    ('G3 editor cannot accept evidence', pg_temp.x(ue, format($$update public.dc_evidence_files set status = 'accepted' where id = %L$$, v_ev)) is not null, null),
    ('G3 verifier accepts evidence', pg_temp.x(ur, format($$update public.dc_evidence_files set status = 'accepted' where id = %L$$, v_ev)) is null, null),
    ('G3 verifier accepts checklist item', pg_temp.x(ur, format($$update public.dc_evidence_checklist_items set status = 'accepted' where id = %L$$, v_ci)) is null, null),
    ('G3 storage: editor may upload into P1 folder', pg_temp.x(ue, format($$insert into storage.objects (bucket_id, name, owner_id) values ('dc-evidence', %L, %L)$$, 'org/' || o1 || '/project/' || p1 || '/general/a.pdf', ue::text)) is null, null),
    ('G3 storage: outsider may not upload into P1 folder', pg_temp.x(ux, format($$insert into storage.objects (bucket_id, name, owner_id) values ('dc-evidence', %L, %L)$$, 'org/' || o1 || '/project/' || p1 || '/general/b.pdf', ux::text)) is not null, null),
    ('G3 storage: viewer cannot read evidence files', pg_temp.q(uv, format($$select count(*) from storage.objects where bucket_id = 'dc-evidence' and name like %L$$, '%' || p1 || '%')) = '0', null),
    ('G3 storage: verifier can read evidence files', pg_temp.q(ur, format($$select count(*) from storage.objects where bucket_id = 'dc-evidence' and name like %L$$, '%' || p1 || '%')) = '1', null);

  -- --------------------------------------------------------------- import commit (valid_only and all_or_nothing)
  r := pg_temp.q(ue, format($$insert into public.dc_import_jobs (project_id, pillar, file_path) values (%L, 'ownership', 'project/%s/x.csv') returning id$$, p1, p1));
  v_job := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values
    ('G2 import valid_only commits good rows, reports bad', pg_temp.q(ue, format($$select public.dc_import_commit(%L, '[{"_row":2,"category":"individual","name":"A"},{"_row":3,"category":"organisation","name":"B","black_pct":20,"bw_pct":50},{"_row":4,"category":"individual","name":"C","shares":10}]'::jsonb, 'valid_only')->>'committed'$$, v_job)) = '2', null);
  insert into _t (name, ok, detail) values
    ('G2 imported rows flagged source=import', (select count(*) = 2 from public.dc_own_shareholders where import_job_id = v_job and source = 'import'), null);
  insert into _t (name, ok, detail) values
    ('G2 committed job cannot be re-committed', pg_temp.q(ue, format($$select public.dc_import_commit(%L, '[]'::jsonb)$$, v_job)) like 'ERROR%', null);
  r := pg_temp.q(ue, format($$insert into public.dc_import_jobs (project_id, pillar, file_path) values (%L, 'ownership', 'project/%s/y.csv') returning id$$, p1, p1));
  v_job := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values
    ('G2 import all_or_nothing rolls back on any error', pg_temp.q(ue, format($$select public.dc_import_commit(%L, '[{"category":"individual","name":"D"},{"category":"organisation","name":"E","black_pct":20,"bw_pct":50}]'::jsonb, 'all_or_nothing')$$, v_job)) like 'ERROR%', null);
  insert into _t (name, ok, detail) values
    ('G2 nothing from failed all_or_nothing import', (select count(*) = 0 from public.dc_own_shareholders where name = 'D' and project_id = p1), null);

  -- --------------------------------------------------------------- copy forward
  r := pg_temp.q(uc, format($$select public.dc_create_project('{"org_id":"%s","fy_end":"2027-02-28","previous_project_id":"%s","copy_pillars":["ownership","management_control","procurement"]}'::jsonb)$$, o1, p1));
  p3 := case when r like 'ERROR%' then null else r::uuid end;
  insert into _t (name, ok, detail) values ('G2 copy forward via wizard', p3 is not null, r);
  insert into _t (name, ok, detail) select 'G2 copied rows are carried_forward and unconfirmed',
    count(*) > 0 and bool_and(source = 'carried_forward' and not confirmed and verification_status = 'unverified' and not sample_selected), count(*)::text
    from public.dc_mc_members where project_id = p3;
  insert into _t (name, ok, detail) values
    ('G2 editing a carried row confirms it', pg_temp.q(ue, format($$with u as (update public.dc_mc_members set position = 'COO' where id = (select id from public.dc_mc_members where project_id = %L limit 1) returning confirmed) select bool_and(confirmed)::text from u$$, p3)) = 'true', null),
    ('G2 copy forward refused across organisations', pg_temp.q(ua, format($$select public.dc_copy_forward(%L, %L, array['ownership'])$$, p1, p2)) like 'ERROR%', null);

  -- --------------------------------------------------------------- audit
  insert into _t (name, ok, detail) select 'G3 audit log records changes', count(*) > 10, count(*)::text from public.dc_audit_log where project_id = p1;
  insert into _t (name, ok, detail) select 'G3 audit never stores ID numbers', count(*) = 0, count(*)::text
    from public.dc_audit_log where org_id = o1 and (coalesce(new::text,'') like '%9001015009086%' or coalesce(old::text,'') like '%9001015009086%');
  insert into _t (name, ok, detail) select 'G3 audit never stores salaries', count(*) = 0, count(*)::text
    from public.dc_audit_log where project_id = p1 and coalesce(new->>'monthly_stipend','***') not like '***%';
  insert into _t (name, ok, detail) values
    ('G3 editor reads project audit', pg_temp.q(ue, format('select (count(*) > 0)::text from public.dc_audit_log where project_id = %L', p1)) = 'true', null),
    ('G3 viewer cannot read audit', pg_temp.q(uv, format('select count(*) from public.dc_audit_log where project_id = %L', p1)) = '0', null),
    ('G3 outsider cannot read audit', pg_temp.q(ux, format('select count(*) from public.dc_audit_log where project_id = %L', p1)) = '0', null);

  -- --------------------------------------------------------------- report and roll everything back
  select count(*) filter (where ok), count(*) filter (where not ok or ok is null),
         string_agg(case when ok then 'PASS ' else 'FAIL ' end || name || coalesce(' [' || left(detail, 200) || ']', ''), E'\n' order by n)
    into pass, fail, report from _t;
  raise exception E'DC GATE TESTS: % passed, % failed (all changes rolled back)\n%', pass, fail, report;
end
$test$;
