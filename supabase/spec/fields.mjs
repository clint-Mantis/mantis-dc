// Single source of truth for the DC capture model (BUILD_PROMPT.md section 7).
// `node supabase/spec/generate.mjs` turns this into:
//   - the capture-table DDL migration
//   - the dc_field_defs / dc_field_rules / dc_lookups seed migration
//   - app/src/generated/spec.json (used by tests and as a fallback)
//
// Field types: money | money_signed | percent | integer | numeric | boolean | text | date | lookup | enum | fk
// fk targets: people | beneficiaries | suppliers | divisions

export const PILLARS = [
  { code: 'financial', label: 'Financial', table: 'dc_fin_sheet', criteria: null, mode: 'single', sort: 1 },
  { code: 'ownership', label: 'Ownership', table: 'dc_own_shareholders', criteria: 'category', mode: 'list', sort: 2 },
  { code: 'management_control', label: 'Management Control', table: 'dc_mc_members', criteria: null, mode: 'list', sort: 3 },
  { code: 'skills_development', label: 'Skills Development', table: 'dc_sd_interventions', criteria: 'criteria', mode: 'list', sort: 4 },
  { code: 'esd', label: 'Enterprise & Supplier Development', table: 'dc_esd_contributions', criteria: 'esd_category', mode: 'list', sort: 5 },
  { code: 'procurement', label: 'Suppliers (Preferential Procurement)', table: 'dc_proc_suppliers', criteria: null, mode: 'list', sort: 6 },
  { code: 'sed', label: 'Socio-Economic Development', table: 'dc_sed_contributions', criteria: 'contribution_type', mode: 'list', sort: 7 },
  { code: 'yes', label: 'Y.E.S. Initiative', table: 'dc_yes_participants', criteria: 'yes_category', mode: 'list', sort: 8 },
];

const occLevels = ['Executive Directors', 'Other Executive Management', 'Senior Management', 'Middle Management', 'Junior Management', 'Semi-skilled', 'Unskilled', 'Temporary employees'];

export const LOOKUPS = {
  race: [['A', 'African'], ['C', 'Coloured'], ['I', 'Indian'], ['W', 'White']],
  gender: [['M', 'Male'], ['F', 'Female']],
  nationality: [['SA', 'South African'], ['FN', 'Foreign National']],
  bee_level: [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `Level ${n}`]), ['NC', 'Non-compliant']],
  bee_level_proc: [...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), `Level ${n}`]), ['NC', 'Non-compliant']],
  occupational_level: occLevels.map((l, i) => [`OL${i + 1}`, l]),
  learning_category: [['ABET', 'ABET'], ['A', 'Category A'], ['B', 'Category B'], ['C', 'Category C'], ['D', 'Category D'], ['E', 'Category E'], ['F', 'Category F']],
  management_level: [['EXEC', 'Executive'], ['SENIOR', 'Senior'], ['MIDDLE', 'Middle'], ['JUNIOR', 'Junior'], ['NONMGMT', 'Non-Management']],
  // meta.benefit_factor intentionally left null: see docs/QUESTIONS.md (not invented)
  esd_contribution_type: [
    'Grant contributions', 'Direct costs', 'Discounts', 'Overhead costs incl. people time', 'Interest-free loans',
    'Standard loans to ED & SD beneficiaries', 'Guarantees or relaxed security', 'Lower interest rate', 'Monthly investments',
    'Investments with lower dividend to financier', 'Professional services at no cost', 'Professional services at a discount',
    'Employee time assisting beneficiary',
  ].map((l, i) => [String(i + 1), l]),
  esd_multiplier: [['NA', 'Not applicable'], ['JOBS', 'New jobs'], ['PRODUCTS', 'New SA products'], ['WAREHOUSING', 'Warehousing'], ['LAND', 'Land reform extension']],
  sed_contribution_type: [
    'Direct grants', 'Direct SED costs incl. sector initiatives', 'Discounts given', 'Overhead costs – monetary',
    'Overhead costs – non-monetary', 'Professional services at no cost', 'Professional services at a discount', 'Employee time contributed',
  ].map((l, i) => [String(i + 1), l]),
  // Placeholder list – TODO verify against the codes (docs/QUESTIONS.md)
  exclusion_reason: [
    ['IMPORTS', 'Imports with no local capacity'], ['TAXES', 'Taxes and levies'], ['SALARIES', 'Salaries and wages'],
    ['EMPOWERMENT', 'Empowerment-related expenditure'], ['PUBLIC', 'Public entity / organ of state'], ['OTHER', 'Other (explain in note)'],
  ],
};

// helper builders
const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

export const FIELDS = {
  financial: [
    f('turnover', 'Turnover', 'money', { group: 'Turnover' }),
    f('turnover_yes', 'Turnover for YES purposes', 'money', { group: 'Turnover' }),
    f('bee_level_prior_year', 'BEE Level from Prior Year', 'lookup', { lookup: 'bee_level', group: 'Turnover' }),
    f('employees_measured_year', 'Number of Employees in measured year', 'integer', { group: 'Employees' }),
    f('employees_end_prev_year', 'Number of Employees at end of previous year', 'integer', { group: 'Employees' }),
    f('sdl_leviable_amount', 'Sum on which the 1% SDL payments are based', 'money', { group: 'Skills levy' }),
    f('cost_of_sales', 'Cost of Sales', 'money', { group: 'Procurement spend' }),
    f('stock_adjustment', 'Stock adjustment figure (+/-)', 'money_signed', { group: 'Procurement spend' }),
    f('total_capital_spend', 'Total Capital Spend', 'money', { group: 'Procurement spend' }),
    f('total_finance_charges', 'Total Finance Charges', 'money', { group: 'Procurement spend' }),
    f('total_expenses', 'Total Expenses', 'money', { group: 'Procurement spend' }),
    f('industry_norm_pct', 'Latest Applicable Industry Norm %', 'percent', { group: 'Profit' }),
    f('as_at_date', 'As at Date', 'date', { group: 'Profit' }),
    f('current_npat', 'Current NPAT', 'money_signed', { group: 'Profit' }),
    f('npat_basis', 'NPAT Applied Using', 'enum', {
      enum: ['current', 'average_prior_years', 'prior_year_pct', 'indicative_margin'],
      enumLabels: ['Current NPAT', 'Average of prior years', 'Prior year %', 'Indicative profit margin'], group: 'Profit',
    }),
    f('indicative_margin_pct', 'Indicative Profit Margin % to be used', 'percent', { group: 'Profit' }),
  ],
  ownership: [
    f('category', 'Category', 'enum', { enum: ['individual', 'organisation'], enumLabels: ['Individual', 'Organisation'], required: true, criteria: true }),
    f('name', 'Shareholder / Organisation Name', 'text', { required: true, legacy: ['Sharholder Name', 'Shareholder Name'] }),
    f('person_id', 'Linked person', 'fk', { fk: 'people', grid: false }),
    f('votes', 'Number of Votes', 'numeric', { group: 'Rights' }),
    f('shares', 'Number of Shares', 'numeric', { group: 'Rights' }),
    f('modified_flow_through', 'Modified Flow-through', 'boolean', { group: 'Rights' }),
    f('modified_flow_through_pct', 'Modified Flow-through %', 'percent', { group: 'Rights' }),
    f('black_person', 'Black Person', 'boolean', { group: 'Black ownership' }),
    f('black_pct', '% Organisation Owned by Black People', 'percent', { group: 'Black ownership' }),
    f('black_woman', 'Black Woman', 'boolean', { group: 'Black women' }),
    f('bw_pct', '% Organisation Owned by Black Women', 'percent', { group: 'Black women' }),
    f('designated_group', 'Black Designated Group', 'boolean', { group: 'Designated groups', legacy: ['Black Degignated Group'] }),
    f('designated_group_pct', '% Owned by Black Designated Group', 'percent', { group: 'Designated groups', legacy: ['% Owned by Black Degignated Group'] }),
    f('qualifying_ownership_scheme', 'Black Person with Qualifying Ownership', 'boolean', { group: 'Schemes' }),
    f('qos_pct', '% Owned by any Qualifying Ownership Scheme', 'percent', { group: 'Schemes' }),
    f('esop', 'Black Person is with an ESOP', 'boolean', { group: 'Schemes' }),
    f('esop_pct', '% Owned by an ESOP', 'percent', { group: 'Schemes' }),
    f('new_entrant', 'Black Person is New Entrant', 'boolean', { group: 'New entrants' }),
    f('new_entrant_pct', '% Owned by Black New Entrants', 'percent', { group: 'New entrants' }),
    f('market_value_claims', 'Market Value of Claims Against Black Entity (R)', 'money', { group: 'Net value' }),
    f('years_since_transaction', 'Years Since BEE Transaction', 'integer', { min: 1, max: 10, group: 'Net value' }),
  ],
  management_control: [
    f('person_id', 'Employee', 'fk', { fk: 'people', required: true }),
    f('position', 'Position / Title', 'text', { group: 'Role' }),
    f('occupational_level', 'Role Classification', 'lookup', { lookup: 'occupational_level', required: true, group: 'Role' }),
    f('division_id', 'Division or Subsidiary', 'fk', { fk: 'divisions', group: 'Role' }),
    f('job_grade', 'Job Grade', 'text', { group: 'Role' }),
    f('votes', 'Number of Votes', 'numeric', { group: 'Role', help: 'Board members only' }),
  ],
  skills_development: [
    f('criteria', 'Skills Criteria', 'enum', {
      enum: ['sd_spend_formal', 'sd_informal_bursaries', 'sd_learners'],
      enumLabels: ['Skills spend – formal', 'Informal training & bursaries', 'Learnerships / learners'], required: true, criteria: true,
    }),
    f('personnel_number', 'Personnel Number', 'text', { group: 'Learner' }),
    f('person_id', 'Learner', 'fk', { fk: 'people', required: true, group: 'Learner' }),
    f('employee', 'Employee', 'boolean', { group: 'Learner' }),
    f('course_name', 'Course Name', 'text', { group: 'Training' }),
    f('learning_category', 'Category', 'lookup', { lookup: 'learning_category', group: 'Training' }),
    f('start_date', 'Date / Start Date', 'date', { group: 'Training' }),
    f('end_date', 'End Date', 'date', { group: 'Training' }),
    f('description', 'Description', 'text', { group: 'Training' }),
    f('course_cost', 'Course Costs / Fees', 'money', { group: 'Cost' }),
    f('ancillary_cost', 'Ancillary costs (travel etc.)', 'money', { group: 'Cost' }),
    f('monthly_stipend', 'Monthly Salary or Stipend', 'money', { group: 'Cost', sensitive: true }),
    f('months_in_period', 'Month in Measured Period', 'integer', { min: 1, max: 12, group: 'Cost' }),
    f('previously_unemployed', 'Previously Unemployed', 'boolean', { group: 'Status' }),
    f('absorbed', 'Absorbed', 'boolean', { group: 'Status' }),
    f('management_level', 'Management Level / Role', 'lookup', { lookup: 'management_level', group: 'Status' }),
    f('office_based', 'Office Based', 'boolean', { group: 'Status' }),
    f('core_critical_skills', 'Core & Critical Skills', 'boolean', { group: 'Status' }),
    f('military_veteran', 'Military Veteran', 'boolean', { group: 'Status' }),
    f('black_designated_group', 'Black Designated Group', 'boolean', { group: 'Status' }),
    f('unemployed_or_student', 'Unemployed or Student', 'boolean', { group: 'Status' }),
    f('employment_status', 'Employed or Unemployed', 'enum', { enum: ['employed', 'unemployed'], enumLabels: ['Employed', 'Unemployed'], group: 'Status' }),
  ],
  esd: [
    f('esd_category', 'ESD Category', 'enum', { enum: ['ed_sd_data', 'sd_early_payment'], enumLabels: ['ED & SD contributions', 'SD early payment'], required: true, criteria: true }),
    f('contribution_type', 'Contribution Type', 'lookup', { lookup: 'esd_contribution_type', group: 'Contribution' }),
    f('year_offset', 'Year', 'integer', { min: 0, max: 4, group: 'Contribution', help: '0 = current year, 1–4 = prior years' }),
    f('beneficiary_id', 'Beneficiary', 'fk', { fk: 'beneficiaries', group: 'Contribution' }),
    f('contribution_amount', 'Contribution Amount', 'money', { group: 'Contribution' }),
    f('outstanding_loan_amount', 'Outstanding Loan Amount', 'money', { group: 'Contribution detail' }),
    f('days_outstanding', 'Days Outstanding', 'integer', { group: 'Contribution detail' }),
    f('guarantee_amount', 'Guarantee Amount', 'money', { group: 'Contribution detail' }),
    f('investment_amount', 'Investment Amount', 'money', { group: 'Contribution detail' }),
    f('commercial_hourly_rate', 'Commercial Hourly Rate', 'money', { group: 'Contribution detail' }),
    f('hourly_discount', 'Hourly Discount', 'money', { group: 'Contribution detail' }),
    f('monthly_salary', 'Monthly Salary', 'money', { group: 'Contribution detail', sensitive: true }),
    f('interest_rate', 'Interest Rate Used', 'percent', { group: 'Contribution detail' }),
    f('dividend_differential', "Contributor's Dividend / Dividend Differential", 'percent', { group: 'Contribution detail' }),
    f('hours_delivered', 'Hours Delivered', 'numeric', { group: 'Contribution detail' }),
    f('category_a_beneficiary', 'Category A Beneficiary', 'boolean', { group: 'Beneficiary' }),
    f('beneficiary_type', 'Valid ED or SD Beneficiary', 'enum', { enum: ['enterprise_development', 'supplier_development'], enumLabels: ['Enterprise development', 'Supplier development'], group: 'Beneficiary' }),
    f('graduation_ed_to_sd', 'Graduation of ED to SD', 'boolean', { group: 'Beneficiary' }),
    f('jobs_created_flag', 'ED or SD Jobs Created', 'boolean', { group: 'Jobs' }),
    f('base_jobs', 'Base Jobs', 'integer', { group: 'Jobs' }),
    f('created_jobs', 'Created Jobs', 'integer', { group: 'Jobs' }),
    f('employees_prior', 'Number of Employees Prior to Intervention', 'integer', { group: 'Jobs' }),
    f('black_owned_51', '51% Black Owned', 'boolean', { group: 'Beneficiary' }),
    f('bwo_51', '51% Black Woman Owned', 'boolean', { group: 'Beneficiary' }),
    f('beneficiary_revenue_last_period', 'Beneficiary Revenue in last fin. period', 'money', { group: 'Beneficiary' }),
    f('sd_programme', 'SD Programme', 'boolean', { group: 'Programme' }),
    f('tier1_qualifying2_supplier', 'Tier 1 & Qualifying 2 Supplier', 'boolean', { group: 'Programme' }),
    f('qualifying_black_intermediary', 'Qualifying Black Intermediary', 'boolean', { group: 'Programme' }),
    f('multiplier_initiative', 'ED & SD initiative for contribution multiplier', 'lookup', { lookup: 'esd_multiplier', group: 'Programme' }),
    f('defence_dev_fund', 'Defence Industry Development Fund', 'boolean', { group: 'Programme' }),
    f('supplier_id', 'Supplier', 'fk', { fk: 'suppliers', group: 'Early payment' }),
    f('ed_category', 'Enterprise Development Category', 'enum', { enum: ['A', 'B'], enumLabels: ['A', 'B'], group: 'Programme' }),
    f('sd_agreement', 'SD Agreement', 'boolean', { group: 'Programme', help: 'Upload the agreement as evidence on this row' }),
    f('invoice_number', 'Supplier Invoice', 'text', { group: 'Early payment' }),
    f('invoice_amount', 'Invoice Amount', 'money', { group: 'Early payment' }),
    f('invoice_date', 'Invoice Date', 'date', { group: 'Early payment' }),
    f('payment_date', 'Payment Date', 'date', { group: 'Early payment' }),
    f('partnership_with_government', 'Contribution in Partnership with Government', 'boolean', { group: 'Programme' }),
    f('recipient_30_bwo', 'Recipient is 30% Black Woman Owned EME/QSE', 'boolean', { group: 'Beneficiary' }),
    f('payment_reference', 'Payment Ref', 'text', { group: 'Early payment' }),
  ],
  procurement: [
    f('supplier_id', 'Supplier', 'fk', { fk: 'suppliers', required: true }),
    f('annual_spend_excl_vat', 'Annual Spend (Excl VAT)', 'money', { required: true, group: 'Spend' }),
    f('bee_level', 'BEE Status', 'lookup', { lookup: 'bee_level_proc', required: true, group: 'Status' }),
    f('certificate_issuer_type', 'Verification Agent / Chartered Accountant / Sworn Affidavit', 'enum', {
      enum: ['verification_agency', 'chartered_accountant', 'sworn_affidavit'], enumLabels: ['Verification agency', 'Chartered accountant', 'Sworn affidavit'], group: 'Certificate',
    }),
    f('certificate_issuer_name', 'Issuer name', 'text', { group: 'Certificate' }),
    f('certificate_expiry', 'BEE Certificate Expiry Date', 'date', { group: 'Certificate' }),
    f('local_supplier', 'Local Supplier', 'boolean', { group: 'Status' }),
    f('classification', 'Classification', 'enum', { enum: ['EME', 'QSE', 'GEN'], enumLabels: ['EME', 'QSE', 'Generic'], group: 'Status' }),
    f('me_sd_beneficiary_3yr', "ME's Supplier Dev. Beneficiary 3-year contract", 'boolean', { group: 'Status' }),
    f('black_owned_eme_qse_3yr', 'Black Owned EME/QSE (3-year contract)', 'boolean', { group: 'Status' }),
    f('black_owned_pct', 'B/O %', 'percent', { group: 'Ownership' }),
    f('bwo_pct', 'BWO %', 'percent', { group: 'Ownership' }),
    f('black_owned_51', '51% Black Owned (flow-through)', 'boolean', { group: 'Ownership' }),
    f('bwo_35', '35% Black Women Owned', 'boolean', { group: 'Ownership' }),
    f('bwo_51', '51% Black Women Owned', 'boolean', { group: 'Ownership' }),
    f('designated_group_supplier', 'Designated Group Supplier', 'boolean', { group: 'Ownership' }),
    f('first_time_supplier', 'First time supplier', 'boolean', { group: 'Status' }),
    f('excluded', 'Exclusion', 'boolean', { group: 'Exclusion' }),
    f('exclusion_reason', 'Exclusion reason', 'lookup', { lookup: 'exclusion_reason', group: 'Exclusion' }),
  ],
  sed: [
    f('contribution_type', 'Category', 'lookup', { lookup: 'sed_contribution_type', required: true, criteria: true }),
    f('beneficiary_id', 'Beneficiary', 'fk', { fk: 'beneficiaries' }),
    f('description', 'Description', 'text'),
    f('contribution_amount', 'Contribution Amount', 'money', { group: 'Value' }),
    f('commercial_hourly_rate', 'Commercial Hourly Rate', 'money', { group: 'Value' }),
    f('hourly_discount', 'Hourly Discount (R)', 'money', { group: 'Value' }),
    f('monthly_salary', 'Monthly Salary', 'money', { group: 'Value', sensitive: true }),
    f('hours', 'Hours', 'numeric', { group: 'Value' }),
    f('pct_black_beneficiaries', '% To Black Beneficiaries', 'percent', { group: 'Value' }),
  ],
  yes: [
    f('yes_category', 'YES Category', 'enum', { enum: ['yes_employment', 'yes_absorption'], enumLabels: ['YES employment', 'YES absorption'], required: true, criteria: true }),
    f('person_id', 'Employee aged 18–35', 'fk', { fk: 'people', required: true }),
    f('sponsored_employer_id', 'Name of EME/DSE Sponsored Employer', 'fk', { fk: 'beneficiaries', group: 'Placement' }),
    f('start_date', 'Start Date', 'date', { group: 'Placement' }),
    f('contract_type', 'Contract of Employment', 'enum', { enum: ['fixed', 'temporary'], enumLabels: ['Fixed term', 'Temporary'], group: 'Placement' }),
    f('months_in_period', 'Months in Measured Period', 'integer', { min: 1, max: 12, group: 'Placement' }),
    f('sd_expenditure', 'Skills Development Expenditure', 'money', { group: 'Outcome' }),
    f('absorbed', 'Absorption by ME or Industry', 'boolean', { group: 'Outcome' }),
    f('commitment_to_absorb', 'Commitment to Absorb', 'boolean', { group: 'Outcome' }),
  ],
};

// ---------- visibility / requirement rules ----------
// { pillar, key, criteria_key?, criteria_value?, sector_code?, visible, required?, label_override?, note? }
// criteria_value null => any. Most specific wins: sector (+2), criteria value (+1).
const R = [];
const hide = (pillar, key, criteria_key, criteria_value = null, extra = {}) => R.push({ pillar, key, criteria_key, criteria_value, visible: false, ...extra });
const show = (pillar, key, criteria_key, criteria_value, extra = {}) => R.push({ pillar, key, criteria_key, criteria_value, visible: true, ...extra });

// Financial: indicative margin only when npat_basis = indicative_margin
hide('financial', 'indicative_margin_pct', 'npat_basis');
show('financial', 'indicative_margin_pct', 'npat_basis', 'indicative_margin', { required: true });

// Ownership
hide('ownership', 'black_pct', 'category');
show('ownership', 'black_pct', 'category', 'organisation');
hide('ownership', 'person_id', 'category', 'organisation');
hide('ownership', 'modified_flow_through_pct', 'modified_flow_through');
show('ownership', 'modified_flow_through_pct', 'modified_flow_through', 'true');

// Skills development
hide('skills_development', 'office_based', 'criteria', 'sd_informal_bursaries');
for (const k of ['ancillary_cost', 'office_based', 'core_critical_skills', 'management_level', 'unemployed_or_student']) {
  hide('skills_development', k, 'criteria', 'sd_learners');
}
const SECTORS_WITH_SD_OVERRIDES = ['CONSTRUCTION', 'FINANCE', 'ICT', 'PROPERTY', 'AGRIBEE', 'DEFENCE', 'MAC'];
for (const s of SECTORS_WITH_SD_OVERRIDES) {
  // Placeholder: no behaviour change yet. TODO verify per sector code (docs/QUESTIONS.md)
  R.push({ pillar: 'skills_development', key: 'core_critical_skills', criteria_key: 'criteria', criteria_value: null, sector_code: s, visible: true, note: 'TODO verify per sector code' });
}

// ESD: early payment vs ED/SD data
const earlyOnly = ['supplier_id', 'invoice_number', 'invoice_amount', 'invoice_date', 'payment_date'];
for (const k of earlyOnly) { hide('esd', k, 'esd_category'); show('esd', k, 'esd_category', 'sd_early_payment'); }
const edOnly = ['contribution_type', 'year_offset', 'beneficiary_id', 'contribution_amount', 'category_a_beneficiary', 'beneficiary_type',
  'graduation_ed_to_sd', 'jobs_created_flag', 'base_jobs', 'created_jobs', 'employees_prior', 'beneficiary_revenue_last_period',
  'sd_programme', 'tier1_qualifying2_supplier', 'qualifying_black_intermediary', 'multiplier_initiative', 'ed_category', 'partnership_with_government'];
for (const k of edOnly) hide('esd', k, 'esd_category', 'sd_early_payment');
const byType = {
  outstanding_loan_amount: ['5', '6'], days_outstanding: ['5', '6'], guarantee_amount: ['7'], investment_amount: ['9', '10'],
  commercial_hourly_rate: ['11', '12', '13'], hourly_discount: ['12'], monthly_salary: ['4', '13'], interest_rate: ['5', '6', '8'],
  dividend_differential: ['10'], hours_delivered: ['11', '12', '13'],
};
for (const [k, types] of Object.entries(byType)) {
  hide('esd', k, 'contribution_type');
  for (const t of types) show('esd', k, 'contribution_type', t);
}
hide('esd', 'defence_dev_fund', 'esd_category');
R.push({ pillar: 'esd', key: 'defence_dev_fund', criteria_key: 'esd_category', criteria_value: null, sector_code: 'DEFENCE', visible: true });

// Procurement
hide('procurement', 'exclusion_reason', 'excluded');
show('procurement', 'exclusion_reason', 'excluded', 'true', { required: true });

// SED: professional services / employee time
const sedType = { commercial_hourly_rate: ['6', '7', '8'], hours: ['6', '7', '8'], hourly_discount: ['7'], monthly_salary: ['8'] };
for (const [k, types] of Object.entries(sedType)) {
  hide('sed', k, 'contribution_type');
  for (const t of types) show('sed', k, 'contribution_type', t);
}

export const RULES = R;

// Learner categories allowed for learnerships (enforced in validation)
export const LEARNER_CATEGORIES = ['B', 'C', 'D'];

// ---------- evidence templates (sector_code null = all sectors). TODO verify wording with Mantis ----------
export const EVIDENCE_TEMPLATES = [
  ['financial', 'Audited / signed annual financial statements', 'Financial statements for the measured year, signed by the auditor or accounting officer', true],
  ['financial', 'SDL payment proofs (EMP201)', 'Monthly EMP201 returns or SARS statement of account for the measured period', true],
  ['financial', 'Turnover and NPAT reconciliation', 'Working paper reconciling turnover, NPAT and procurement spend to the financials', false],
  ['ownership', 'Share register and share certificates', 'Current share register and copies of share certificates', true],
  ['ownership', 'Shareholder agreements / MOI', 'Memorandum of Incorporation and shareholder or trust agreements', true],
  ['ownership', 'Shareholder ID documents', 'Certified ID copies for black shareholders', true],
  ['management_control', 'Organogram and board list', 'Organisational structure and board composition at measurement date', true],
  ['management_control', 'Employee list (EEA2/EEA4)', 'Employee list with race, gender and occupational level', true],
  ['skills_development', 'Training invoices and proof of payment', 'Invoices and payment proof for every training intervention', true],
  ['skills_development', 'Attendance registers / certificates', 'Attendance registers, completion certificates or learner agreements', true],
  ['skills_development', 'WSP and ATR submissions', 'Workplace Skills Plan and Annual Training Report with SETA acknowledgement', false],
  ['esd', 'ED / SD agreements', 'Signed agreements with each enterprise or supplier development beneficiary', true],
  ['esd', 'Proof of ESD contributions', 'Payment proof or valuation for each contribution', true],
  ['esd', 'Beneficiary BEE certificates / affidavits', 'Current BEE status evidence for each beneficiary', true],
  ['procurement', 'Supplier BEE certificates / affidavits', 'Valid certificate or sworn affidavit per supplier (can be attached to each row)', true],
  ['procurement', 'Total Measured Procurement Spend calculation', 'Working paper for TMPS including exclusions', true],
  ['sed', 'SED agreements / beneficiary letters', 'Agreements or letters from each SED beneficiary', true],
  ['sed', 'Proof of SED contributions', 'Payment proof or valuation per contribution', true],
  ['yes', 'Y.E.S. registration and agreement', 'YES programme registration and agreement', true],
  ['yes', 'YES participant contracts', 'Fixed-term contracts for each YES participant', true],
];
