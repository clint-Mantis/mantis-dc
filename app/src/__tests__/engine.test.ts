import { describe, it, expect } from 'vitest';
import fixture from './meta.fixture.json';
import {
  fieldStates, validateRow, coerce, parseNumber, parseDate, parseBool, saIdValid, saIdDob, ageAt, autoMap, importColumns,
  formatMoney, type Meta,
} from '@engine';
import { parseCsv, buildRows } from '../../../supabase/functions/_shared/importer';
import { validateWithZod } from '../lib/schema';
import { periodFor } from '../pages/WizardPage';

// Fixture = the live seed (dc_pillars, dc_field_defs, dc_field_rules, dc_lookups) exported from the test database.
const meta = fixture as unknown as Meta;
const lk = (type: string, code: string) => meta.lookups.find((l) => l.type === type && l.code === code)!.id;
const state = (pillar: string, sector: string, row: Record<string, unknown>, key: string) => fieldStates(meta, pillar, sector, row).find((s) => s.key === key)!;
const noMasters = { people: [], suppliers: [], beneficiaries: [], divisions: [] };

describe('visibility rules', () => {
  it('indicative margin only for the indicative_margin NPAT basis, and then required', () => {
    expect(state('financial', 'DTI', {}, 'indicative_margin_pct').visible).toBe(false);
    const s = state('financial', 'DTI', { npat_basis: 'indicative_margin' }, 'indicative_margin_pct');
    expect(s.visible).toBe(true); expect(s.required).toBe(true);
  });
  it('black % is shown for organisation shareholders only', () => {
    expect(state('ownership', 'DTI', { category: 'individual' }, 'black_pct').visible).toBe(false);
    expect(state('ownership', 'DTI', { category: 'organisation' }, 'black_pct').visible).toBe(true);
  });
  it('skills criteria change the form', () => {
    expect(state('skills_development', 'DTI', { criteria: 'sd_spend_formal' }, 'office_based').visible).toBe(true);
    expect(state('skills_development', 'DTI', { criteria: 'sd_informal_bursaries' }, 'office_based').visible).toBe(false);
    expect(state('skills_development', 'DTI', { criteria: 'sd_learners' }, 'ancillary_cost').visible).toBe(false);
    expect(state('skills_development', 'DTI', { criteria: 'sd_learners' }, 'monthly_stipend').visible).toBe(true);
  });
  it('ESD fields follow category and contribution type', () => {
    expect(state('esd', 'DTI', { esd_category: 'ed_sd_data' }, 'invoice_date').visible).toBe(false);
    expect(state('esd', 'DTI', { esd_category: 'sd_early_payment' }, 'invoice_date').visible).toBe(true);
    expect(state('esd', 'DTI', { esd_category: 'sd_early_payment' }, 'contribution_amount').visible).toBe(false);
    expect(state('esd', 'DTI', { esd_category: 'ed_sd_data', contribution_type: lk('esd_contribution_type', '5') }, 'outstanding_loan_amount').visible).toBe(true);
    expect(state('esd', 'DTI', { esd_category: 'ed_sd_data', contribution_type: lk('esd_contribution_type', '1') }, 'outstanding_loan_amount').visible).toBe(false);
  });
  it('defence fund only for the Defence sector code', () => {
    expect(state('esd', 'DTI', { esd_category: 'ed_sd_data' }, 'defence_dev_fund').visible).toBe(false);
    expect(state('esd', 'DEFENCE', { esd_category: 'ed_sd_data' }, 'defence_dev_fund').visible).toBe(true);
  });
  it('exclusion reason required when excluded', () => {
    const s = state('procurement', 'DTI', { excluded: true }, 'exclusion_reason');
    expect(s.visible && s.required).toBe(true);
  });
});

describe('row validation', () => {
  it('reports required fields and cross-field rules', () => {
    const e = validateRow(meta, 'ownership', 'DTI', { category: 'organisation', black_pct: 30, bw_pct: 40 });
    expect(e.map((x) => x.column)).toEqual(expect.arrayContaining(['name', 'bw_pct']));
    expect(validateRow(meta, 'esd', 'DTI', { esd_category: 'sd_early_payment', invoice_date: '2025-05-10', payment_date: '2025-05-01' }).some((x) => x.column === 'payment_date')).toBe(true);
    expect(validateRow(meta, 'skills_development', 'DTI', { criteria: 'sd_learners', person_id: 'x', learning_category: lk('learning_category', 'A') }).some((x) => x.column === 'learning_category')).toBe(true);
  });
  it('zod schema built from metadata gives field messages', () => {
    const e = validateWithZod(meta, 'procurement', 'DTI', { supplier_id: 'abc', annual_spend_excl_vat: -5, bee_level: null });
    expect(e.annual_spend_excl_vat).toMatch(/negative/);
    expect(e.bee_level).toMatch(/required/i);
    expect(validateWithZod(meta, 'ownership', 'DTI', { category: 'individual', name: 'A', years_since_transaction: 12 }).years_since_transaction).toMatch(/at most 10/);
  });
});

describe('South African formats', () => {
  it('parses money and numbers', () => {
    expect(parseNumber('R 1 234 567,89')).toBe(1234567.89);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('(500)')).toBe(-500);
    expect(Number.isNaN(parseNumber('abc'))).toBe(true);
    expect(formatMoney(1234567.891)).toBe('R 1 234 567.89');
  });
  it('parses dates, booleans and SA ID numbers', () => {
    expect(parseDate('28/02/2026')).toBe('2026-02-28');
    expect(parseDate('2026-02-30')).toBe('invalid');
    expect(parseDate(45000)).toBe('2023-03-15');
    expect(parseBool('Ja')).toBe(true);
    expect(saIdValid('9001015009086')).toBe(true);
    expect(saIdValid('9001015009087')).toBe(false);
    expect(saIdDob('9001015009086')).toBe('1990-01-01');
    expect(ageAt('2000-06-15', '2025-06-14')).toBe(24);
  });
  it('measurement period label', () => {
    expect(periodFor('2026-02-28')).toEqual({ start: '2025-03-01', end: '2026-02-28', label: 'FY2026 (Mar 2025–Feb 2026)' });
  });
});

describe('import', () => {
  it('auto-maps legacy headers and coerces lookups by label or code', () => {
    const map = autoMap(meta, 'ownership', ['Sharholder Name', '% Owned by Black Degignated Group', 'Category']);
    expect(map).toEqual({ 'Sharholder Name': 'name', '% Owned by Black Degignated Group': 'designated_group_pct', Category: 'category' });
    const def = meta.defs.find((d) => d.pillar === 'procurement' && d.key === 'bee_level')!;
    expect(coerce(meta, def, { value: 'Level 2' }).value).toBe(lk('bee_level_proc', '2'));
    expect(coerce(meta, def, { value: 'nc' }).value).toBe(lk('bee_level_proc', 'NC'));
    expect(coerce(meta, def, { value: 'Level 9' }).error).toBeTruthy();
  });
  it('expands people columns and builds rows with new masters', () => {
    expect(importColumns(meta, 'management_control').map((c) => c.label).slice(0, 3)).toEqual(['Surname', 'First Name', 'ID Number']);
    const sheet = parseCsv('Surname,First Name,ID Number,Role Classification\nMokoena,Thabo,9001015009086,Senior Management\nSmith,Jo,,Nope\n');
    const rows = buildRows(meta, 'management_control', 'DTI', '2025-03-01', sheet, autoMap(meta, 'management_control', sheet.headers), noMasters);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].values.person_id).toBe('new:id:9001015009086');
    expect(rows[1].errors.map((e) => e.column)).toContain('occupational_level');
  });
  it('defaults procurement ownership flags from percentages', () => {
    const sheet = parseCsv('Supplier Name;Annual Spend (Excl VAT);BEE Status;B/O %;BWO %\nAcme;R 10 000;Level 1;60;40\n');
    const r = buildRows(meta, 'procurement', 'DTI', '2025-03-01', sheet, autoMap(meta, 'procurement', sheet.headers), noMasters)[0];
    expect(r.errors).toEqual([]);
    expect(r.values).toMatchObject({ annual_spend_excl_vat: 10000, black_owned_51: true, bwo_35: true, bwo_51: false });
  });
  it('checks Y.E.S. age at start date', () => {
    const sheet = parseCsv('YES Category,Surname,First Name,ID Number,Start Date\nyes_employment,Old,Person,7001015009088,2025-04-01\n');
    expect(saIdValid('7001015009088')).toBe(true);
    const r = buildRows(meta, 'yes', 'DTI', '2025-03-01', sheet, autoMap(meta, 'yes', sheet.headers), noMasters)[0];
    expect(r.errors.some((e) => /18–35/.test(e.message))).toBe(true);
  });
});
