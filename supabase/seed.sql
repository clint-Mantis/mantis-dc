-- Demo data for LOCAL development and the Playwright gate tests only.
-- Never run this against the live Mantis Hub database (it creates a demo organisation and users).
-- Logins created (password: DemoPass123!):
--   admin@demo.local (Mantis admin), consultant@demo.local, editor@demo.local, viewer@demo.local, verifier@demo.local
do $seed$
declare
  o uuid; p uuid; prod uuid; v_div uuid;
  ua uuid := '11111111-1111-4111-8111-111111111111';
  uc uuid := '22222222-2222-4222-8222-222222222222';
  ue uuid := '33333333-3333-4333-8333-333333333333';
  uv uuid := '44444444-4444-4444-8444-444444444444';
  ur uuid := '55555555-5555-4555-8555-555555555555';
  ppl uuid[] := '{}'; sup uuid[] := '{}'; ben uuid[] := '{}';
  i int; v_id uuid;
  ids text[] := array['8001015009087','8202025009089','8503035009088','8704045009080','8805055009082','9006065009084','9107075009088','9208085009082','9309095009086','9410105009080','0001015009085','0202025009087'];
  surnames text[] := array['Mokoena','Naidoo','Dlamini','van der Merwe','Khumalo','Pillay','Botha','Nkosi','Mahlangu','Adams','Zulu','Sithole'];
  firsts text[] := array['Thabo','Priya','Zanele','Pieter','Sipho','Kavitha','Annelie','Lerato','Bongani','Fatima','Ayanda','Nomsa'];
begin
  -- users (local GoTrue only)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, extensions.crypt('DemoPass123!', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', x.name), now(), now()
    from (values (ua, 'admin@demo.local', 'Demo Admin'), (uc, 'consultant@demo.local', 'Demo Consultant'), (ue, 'editor@demo.local', 'Demo Editor'),
                 (uv, 'viewer@demo.local', 'Demo Viewer'), (ur, 'verifier@demo.local', 'Demo Verifier')) x(id, email, name)
  on conflict (id) do nothing;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now()
    from auth.users u where u.id in (ua, uc, ue, uv, ur)
  on conflict do nothing;

  insert into public.organisations (name, org_type, status) values ('Demo Manufacturing (Pty) Ltd', 'client', 'active') returning id into o;
  insert into public.dc_admins (user_id) values (ua) on conflict do nothing;
  insert into public.dc_memberships (user_id, org_id, role) values (uc, o, 'consultant'), (ue, o, 'client_editor'), (uv, o, 'client_viewer');
  insert into public.dc_profiles (user_id, full_name) values (ua, 'Demo Admin'), (uc, 'Demo Consultant'), (ue, 'Demo Editor'), (uv, 'Demo Viewer'), (ur, 'Demo Verifier') on conflict do nothing;
  insert into public.dc_org_divisions (org_id, name) values (o, 'Head Office') returning id into v_div;
  select id into prod from public.dc_products order by code limit 1;

  insert into public.dc_projects (org_id, division_id, product_id, sector_code, size, title, fy_end, period_start, period_end, status, data_deadline, verification_date)
  values (o, v_div, prod, 'DTI', 'GENERIC', 'FY2026 (Mar 2025–Feb 2026)', '2026-02-28', '2025-03-01', '2026-02-28', 'capturing', '2026-04-30', '2026-05-20')
  returning id into p;
  insert into public.dc_project_members (project_id, user_id, role) values (p, ur, 'verifier');
  insert into public.dc_pillar_status (project_id, pillar) select p, code from public.dc_pillars;
  insert into public.dc_evidence_checklist_items (project_id, pillar, title, description, required, sort)
    select p, pillar, title, description, required, sort from public.dc_evidence_templates where sector_code is null;

  -- masters
  for i in 1..12 loop
    insert into public.dc_people (org_id, surname, first_name, id_number, race_lookup, gender_lookup, nationality_lookup)
    values (o, surnames[i], firsts[i], ids[i],
            (select id from public.dc_lookups where type = 'race' and code = (array['A','I','A','W','A','I','W','A','A','C','A','A'])[i]),
            (select id from public.dc_lookups where type = 'gender' and code = (array['M','F','F','M','M','F','F','F','M','F','M','F'])[i]),
            (select id from public.dc_lookups where type = 'nationality' and code = 'SA'))
    returning id into v_id;
    ppl := ppl || v_id;
  end loop;
  for i in 1..10 loop
    insert into public.dc_suppliers (org_id, vendor_number, name, reg_no, vat_no)
    values (o, 'V' || lpad(i::text, 4, '0'), (array['Acme Steel','Bokamoso Logistics','Cape Packaging','Durban Chemicals','Egoli Electrical','Fynbos Foods','Gauteng Print','Highveld Security','Isizwe Cleaning','Jozi IT Services'])[i],
            '2010/0000' || i || '/07', '4' || lpad(i::text, 9, '0'))
    returning id into v_id;
    sup := sup || v_id;
  end loop;
  for i in 1..3 loop
    insert into public.dc_beneficiaries (org_id, name, black_owned_pct, bwo_pct, classification)
    values (o, (array['Ubuntu Bakery','Kasi Welding Co-op','Thuso Youth Trust'])[i], (array[100, 80, 100])[i], (array[60, 20, 100])[i], 'EME')
    returning id into v_id;
    ben := ben || v_id;
  end loop;

  -- financial
  insert into public.dc_fin_sheet (project_id, turnover, turnover_yes, employees_measured_year, sdl_leviable_amount, cost_of_sales, total_expenses, current_npat, npat_basis)
  values (p, 85000000, 85000000, 120, 24000000, 41000000, 18000000, 6200000, 'current');
  insert into public.dc_fin_history (project_id, year_offset, npat, turnover) select p, g, 5000000 + g * 250000, 80000000 - g * 3000000 from generate_series(1,4) g;
  insert into public.dc_fin_sdl_payments (project_id, month_no, amount) select p, g, 20000 from generate_series(1,12) g;

  -- ownership: 3 shareholders
  insert into public.dc_own_shareholders (project_id, category, name, person_id, shares, votes, black_person, black_woman) values
    (p, 'individual', 'Zanele Dlamini', ppl[3], 300, 300, true, true),
    (p, 'individual', 'Pieter van der Merwe', ppl[4], 450, 450, false, false);
  insert into public.dc_own_shareholders (project_id, category, name, shares, votes, black_pct, bw_pct)
    values (p, 'organisation', 'Isizwe Empowerment Holdings', 250, 250, 100, 45);

  -- management control: 10 members
  for i in 1..10 loop
    insert into public.dc_mc_members (project_id, person_id, position, occupational_level, division_id)
    values (p, ppl[i], (array['CEO','CFO','COO','HR Director','Sales Manager','Finance Manager','Plant Manager','Team Lead','Supervisor','Clerk'])[i],
            (select id from public.dc_lookups where type = 'occupational_level' and code = 'OL' || least(i, 7)::text), v_div);
  end loop;

  -- suppliers: 10 procurement rows
  for i in 1..10 loop
    insert into public.dc_proc_suppliers (project_id, supplier_id, annual_spend_excl_vat, bee_level, certificate_issuer_type, certificate_expiry, black_owned_pct, bwo_pct, black_owned_51, bwo_35, bwo_51, classification)
    values (p, sup[i], 250000 * i, (select id from public.dc_lookups where type = 'bee_level_proc' and code = (((i - 1) % 8) + 1)::text),
            (array['verification_agency','sworn_affidavit'])[1 + i % 2], '2026-01-31'::date + i * 20, (i * 9) % 101, (i * 5) % 51,
            (i * 9) % 101 >= 51, (i * 5) % 51 >= 35, (i * 5) % 51 >= 51, (array['EME','QSE','GEN'])[1 + i % 3]);
  end loop;

  -- skills, ESD, SED, YES
  insert into public.dc_sd_interventions (project_id, criteria, person_id, course_name, learning_category, start_date, end_date, course_cost, employee) values
    (p, 'sd_spend_formal', ppl[5], 'Management Development Programme', (select id from public.dc_lookups where type = 'learning_category' and code = 'B'), '2025-04-01', '2025-09-30', 45000, true),
    (p, 'sd_learners', ppl[11], 'Electrical Learnership NQF4', (select id from public.dc_lookups where type = 'learning_category' and code = 'C'), '2025-03-15', '2026-02-28', 30000, false);
  update public.dc_sd_interventions set monthly_stipend = 4500, months_in_period = 11, previously_unemployed = true where project_id = p and criteria = 'sd_learners';
  insert into public.dc_esd_contributions (project_id, esd_category, contribution_type, year_offset, beneficiary_id, contribution_amount, beneficiary_type) values
    (p, 'ed_sd_data', (select id from public.dc_lookups where type = 'esd_contribution_type' and code = '1'), 0, ben[1], 250000, 'enterprise_development'),
    (p, 'ed_sd_data', (select id from public.dc_lookups where type = 'esd_contribution_type' and code = '5'), 0, ben[2], 400000, 'supplier_development');
  update public.dc_esd_contributions set outstanding_loan_amount = 300000, interest_rate = 0 where project_id = p and contribution_amount = 400000;
  insert into public.dc_esd_contributions (project_id, esd_category, supplier_id, invoice_number, invoice_amount, invoice_date, payment_date)
    values (p, 'sd_early_payment', sup[2], 'INV-1042', 85000, '2025-06-01', '2025-06-08');
  insert into public.dc_sed_contributions (project_id, contribution_type, beneficiary_id, description, contribution_amount, pct_black_beneficiaries) values
    (p, (select id from public.dc_lookups where type = 'sed_contribution_type' and code = '1'), ben[3], 'Bursaries for Grade 12 learners', 180000, 100);
  insert into public.dc_yes_participants (project_id, yes_category, person_id, start_date, contract_type, months_in_period, sd_expenditure)
    values (p, 'yes_employment', ppl[12], '2025-04-01', 'fixed', 11, 12000);
end
$seed$;
