// DC capture engine – shared by the React app and the Edge Functions.
// Mirrors dc.field_state / dc.validate_row in Postgres (the database re-checks everything).
// Pure TypeScript, no runtime dependencies.

export type DataType =
  | 'money' | 'money_signed' | 'percent' | 'integer' | 'numeric' | 'boolean' | 'text' | 'date' | 'lookup' | 'enum' | 'fk';
export type FkTarget = 'people' | 'beneficiaries' | 'suppliers' | 'divisions';

export interface Pillar { code: string; label: string; table_name: string; criteria_key: string | null; mode: 'single' | 'list'; sort: number }
export interface FieldDef {
  pillar: string; key: string; label: string; data_type: DataType; lookup_type?: string | null;
  enum_values?: string[] | null; enum_labels?: string[] | null; fk_target?: FkTarget | null;
  min_value?: number | null; max_value?: number | null; required: boolean; is_criteria?: boolean; sensitive?: boolean;
  help?: string | null; sort: number; grid_visible?: boolean; group_name?: string | null; legacy_labels?: string[] | null;
}
export interface FieldRule {
  pillar: string; key: string; criteria_key: string | null; criteria_value: string | null; sector_code: string | null;
  visible: boolean; required: boolean | null; label_override: string | null;
}
export interface Lookup { id: string; type: string; code: string; label: string; sort: number; active?: boolean; meta?: Record<string, unknown> }
export interface FieldState { key: string; label: string; visible: boolean; required: boolean; def: FieldDef }
export interface Meta { pillars: Pillar[]; defs: FieldDef[]; rules: FieldRule[]; lookups: Lookup[] }

export const SYSTEM_KEYS = ['id', 'project_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'sample_selected',
  'verification_status', 'row_locked', 'source', 'confirmed', 'import_job_id', 'days_to_pay'];

const lookupById = new WeakMap<Lookup[], Map<string, Lookup>>();
export function lookupMap(lookups: Lookup[]): Map<string, Lookup> {
  let m = lookupById.get(lookups);
  if (!m) { m = new Map(lookups.map((l) => [l.id, l])); lookupById.set(lookups, m); }
  return m;
}

/** code of a row value: lookups resolve to their code, booleans to 'true'/'false' */
export function valueCode(meta: Meta, pillar: string, key: string | null, row: Record<string, unknown>): string | null {
  if (!key) return null;
  const v = row[key];
  if (v === null || v === undefined || v === '') return null;
  const def = meta.defs.find((d) => d.pillar === pillar && d.key === key);
  if (def?.data_type === 'lookup') return lookupMap(meta.lookups).get(String(v))?.code ?? null;
  return String(v);
}

/** Effective visibility / requirement for every field of a pillar (most specific rule wins; hide wins a tie). */
export function fieldStates(meta: Meta, pillarCode: string, sector: string, row: Record<string, unknown>): FieldState[] {
  const pillar = meta.pillars.find((p) => p.code === pillarCode);
  const defs = meta.defs.filter((d) => d.pillar === pillarCode).sort((a, b) => a.sort - b.sort);
  const rules = meta.rules.filter((r) => r.pillar === pillarCode);
  return defs.map((def) => {
    let best: FieldRule | null = null;
    let bestScore = -1;
    for (const r of rules) {
      if (r.key !== def.key) continue;
      if (r.sector_code && r.sector_code !== sector) continue;
      if (r.criteria_value !== null && r.criteria_value !== undefined) {
        const ck = r.criteria_key ?? pillar?.criteria_key ?? null;
        if (valueCode(meta, pillarCode, ck, row) !== r.criteria_value) continue;
      }
      const score = (r.sector_code ? 2 : 0) + (r.criteria_value !== null && r.criteria_value !== undefined ? 1 : 0);
      if (score > bestScore || (score === bestScore && best && best.visible && !r.visible)) { best = r; bestScore = score; }
    }
    return {
      key: def.key,
      label: best?.label_override ?? def.label,
      visible: best ? best.visible : true,
      required: best?.required ?? def.required,
      def,
    };
  });
}

export interface RowError { column: string; message: string }

const isBlank = (v: unknown) => v === null || v === undefined || v === '';

/** Validates a typed row (values already coerced). Returns field-level errors. */
export function validateRow(meta: Meta, pillar: string, sector: string, row: Record<string, unknown>): RowError[] {
  const errors: RowError[] = [];
  for (const s of fieldStates(meta, pillar, sector, row)) {
    const v = row[s.key];
    if (!s.visible) continue;
    if (s.required && isBlank(v)) { errors.push({ column: s.key, message: `${s.label} is required` }); continue; }
    if (isBlank(v)) continue;
    const d = s.def;
    if (['money', 'percent', 'integer', 'numeric'].includes(d.data_type)) {
      const n = Number(v);
      if (Number.isNaN(n)) { errors.push({ column: s.key, message: `${s.label} must be a number` }); continue; }
      if (n < 0) errors.push({ column: s.key, message: `${s.label} cannot be negative` });
      if (d.data_type === 'percent' && n > 100) errors.push({ column: s.key, message: `${s.label} must be between 0 and 100` });
      if (d.data_type === 'integer' && !Number.isInteger(n)) errors.push({ column: s.key, message: `${s.label} must be a whole number` });
      if (d.min_value !== null && d.min_value !== undefined && n < d.min_value) errors.push({ column: s.key, message: `${s.label} must be at least ${d.min_value}` });
      if (d.max_value !== null && d.max_value !== undefined && n > d.max_value) errors.push({ column: s.key, message: `${s.label} must be at most ${d.max_value}` });
    }
    if (d.data_type === 'enum' && d.enum_values && !d.enum_values.includes(String(v))) {
      errors.push({ column: s.key, message: `${s.label}: "${v}" is not an allowed option` });
    }
    if (d.data_type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      errors.push({ column: s.key, message: `${s.label} must be a date (YYYY-MM-DD)` });
    }
  }
  // cross-field rules (mirror table check constraints / validate_row)
  const num = (k: string) => (isBlank(row[k]) ? null : Number(row[k]));
  if (pillar === 'ownership' && num('bw_pct') !== null && num('black_pct') !== null && num('bw_pct')! > num('black_pct')!) {
    errors.push({ column: 'bw_pct', message: '% owned by black women cannot exceed % owned by black people' });
  }
  if (pillar === 'skills_development') {
    if (row.start_date && row.end_date && String(row.end_date) < String(row.start_date)) {
      errors.push({ column: 'end_date', message: 'End date must be on or after the start date' });
    }
    if (row.criteria === 'sd_learners' && row.learning_category) {
      const code = lookupMap(meta.lookups).get(String(row.learning_category))?.code;
      if (code && !['B', 'C', 'D'].includes(code)) errors.push({ column: 'learning_category', message: 'Learnerships must use category B, C or D' });
    }
  }
  if (pillar === 'esd' && row.invoice_date && row.payment_date && String(row.payment_date) < String(row.invoice_date)) {
    errors.push({ column: 'payment_date', message: 'Payment date must be on or after the invoice date' });
  }
  return errors;
}

// ---------------------------------------------------------------- SA ID
export function saIdValid(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
export function saIdDob(id: string, today = new Date()): string | null {
  if (!/^\d{6}/.test(id)) return null;
  const yy = Number(id.slice(0, 2));
  const y = 2000 + yy <= today.getFullYear() ? 2000 + yy : 1900 + yy;
  const m = Number(id.slice(2, 4)); const d = Number(id.slice(4, 6));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
export function ageAt(dob: string, at: string): number {
  const [y1, m1, d1] = dob.split('-').map(Number); const [y2, m2, d2] = at.split('-').map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

// ---------------------------------------------------------------- formatting (South Africa)
export function formatMoney(v: unknown): string {
  if (isBlank(v)) return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const [i, f] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${f}`;
}
export function formatNumber(v: unknown, decimals = 2): string {
  if (isBlank(v)) return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const [i, f] = Math.abs(n).toFixed(decimals).split('.');
  const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${s}${f && Number(f) !== 0 ? '.' + f.replace(/0+$/, '') : ''}`;
}

// ---------------------------------------------------------------- import coercion
export const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9%]+/g, ' ').trim();

export interface CellIn { value: unknown; isPercentFormat?: boolean }

export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim().replace(/^R\s*/i, '').replace(/[\s ']/g, '');
  if (s === '' || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/%$/, '');
  // "1.234,56" or "1234,56" -> decimal comma
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (Number.isNaN(n)) return NaN;
  return neg ? -n : n;
}

export function parseBool(raw: unknown): boolean | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'x', 'ja'].includes(s)) return true;
  if (['n', 'no', 'false', '0', 'nee'].includes(s)) return false;
  return 'invalid';
}

export function parseDate(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? 'invalid' : raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') {
    // Excel serial date (1900 system)
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // South African DD/MM/YYYY
  if (m) return iso(+m[3], +m[2], +m[1]);
  return 'invalid';
}
function iso(y: number, mo: number, d: number): string | 'invalid' {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return 'invalid';
  return dt.toISOString().slice(0, 10);
}

/** Coerce one raw cell to the field's storage type. fk fields are resolved elsewhere. */
export function coerce(meta: Meta, def: FieldDef, cell: CellIn): { value: unknown; error?: string } {
  const raw = cell.value;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { value: def.data_type === 'boolean' ? undefined : null };
  }
  switch (def.data_type) {
    case 'money': case 'money_signed': case 'numeric': case 'integer': case 'percent': {
      let n = parseNumber(raw);
      if (n === null) return { value: null };
      if (Number.isNaN(n)) return { value: null, error: `"${raw}" is not a number` };
      if (def.data_type === 'percent' && cell.isPercentFormat) n = n * 100;
      if (def.data_type === 'percent' && typeof raw === 'string' && raw.trim().endsWith('%')) n = parseNumber(raw.replace('%', ''))!;
      if (def.data_type === 'integer' && !Number.isInteger(n)) return { value: n, error: `"${raw}" is not a whole number` };
      return { value: Math.round(n * 10000) / 10000 };
    }
    case 'boolean': {
      const b = parseBool(raw);
      if (b === 'invalid') return { value: undefined, error: `"${raw}" is not Yes/No` };
      return { value: b ?? undefined };
    }
    case 'date': {
      const d = parseDate(raw);
      if (d === 'invalid') return { value: null, error: `"${raw}" is not a date (use YYYY-MM-DD)` };
      return { value: d };
    }
    case 'lookup': {
      const s = norm(String(raw));
      const opts = meta.lookups.filter((l) => l.type === def.lookup_type);
      const hit = opts.find((l) => norm(l.code) === s || norm(l.label) === s)
        ?? opts.find((l) => norm(l.label).replace(/^level /, '') === s.replace(/^level /, ''));
      if (!hit) return { value: null, error: `"${raw}" is not a valid option (${opts.map((o) => o.label).slice(0, 8).join(', ')}${opts.length > 8 ? ', …' : ''})` };
      return { value: hit.id };
    }
    case 'enum': {
      const s = norm(String(raw));
      const vals = def.enum_values ?? [];
      const labels = def.enum_labels ?? [];
      const i = vals.findIndex((v, idx) => norm(v) === s || norm(labels[idx] ?? '') === s);
      if (i < 0) return { value: null, error: `"${raw}" is not one of: ${labels.join(', ') || vals.join(', ')}` };
      return { value: vals[i] };
    }
    case 'text': return { value: String(raw).trim() };
    default: return { value: raw };
  }
}

// ---------------------------------------------------------------- import columns
/** Extra columns that describe a master record (people / suppliers / beneficiaries / divisions) */
export const MASTER_COLUMNS: Record<FkTarget, { key: string; label: string; aliases: string[] }[]> = {
  people: [
    { key: 'surname', label: 'Surname', aliases: ['last name', 'lastname'] },
    { key: 'first_name', label: 'First Name', aliases: ['firstname', 'name', 'first names'] },
    { key: 'id_number', label: 'ID Number', aliases: ['id', 'id no', 'identity number', 'sa id', 'passport'] },
    { key: 'race', label: 'Race', aliases: [] },
    { key: 'gender', label: 'Gender', aliases: ['sex'] },
    { key: 'nationality', label: 'Nationality', aliases: [] },
    { key: 'disabled', label: 'Disabled', aliases: ['disability'] },
  ],
  suppliers: [
    { key: 'vendor_number', label: 'Vendor Number', aliases: ['vendor no', 'supplier number', 'vendor code', 'supplier code'] },
    { key: 'name', label: 'Supplier Name', aliases: ['supplier', 'vendor name', 'name'] },
    { key: 'reg_no', label: 'Supplier Reg No', aliases: ['reg no', 'registration number', 'company registration'] },
    { key: 'vat_no', label: 'Supplier VAT No', aliases: ['vat no', 'vat number'] },
    { key: 'contact_person', label: 'Contact Person', aliases: ['contact'] },
    { key: 'tel', label: 'Tel', aliases: ['telephone', 'phone'] },
    { key: 'email', label: 'Email', aliases: ['e mail'] },
  ],
  beneficiaries: [
    { key: 'name', label: 'Beneficiary Name', aliases: ['beneficiary'] },
    { key: 'reg_no', label: 'Beneficiary Reg No', aliases: [] },
  ],
  divisions: [{ key: 'name', label: 'Division', aliases: ['division or subsidiary', 'subsidiary'] }],
};

export interface ImportColumn { id: string; label: string; kind: 'field' | 'master'; fieldKey: string; masterKey?: string; aliases: string[] }

/** All columns an import (or template) for a pillar can carry. fk fields expand into master columns. */
export function importColumns(meta: Meta, pillar: string): ImportColumn[] {
  const cols: ImportColumn[] = [];
  for (const d of meta.defs.filter((x) => x.pillar === pillar).sort((a, b) => a.sort - b.sort)) {
    if (d.data_type === 'fk' && d.fk_target) {
      const prefix = d.fk_target === 'beneficiaries' && d.key !== 'beneficiary_id' ? `${d.label} – ` : '';
      for (const mc of MASTER_COLUMNS[d.fk_target]) {
        cols.push({ id: `${d.key}.${mc.key}`, label: prefix + mc.label, kind: 'master', fieldKey: d.key, masterKey: mc.key,
          aliases: prefix ? [] : [mc.label, ...mc.aliases] });
      }
    } else {
      cols.push({ id: d.key, label: d.label, kind: 'field', fieldKey: d.key, aliases: [d.label, d.key, ...(d.legacy_labels ?? [])] });
    }
  }
  return cols;
}

/** Suggest a header -> column id map (exact label/key/legacy label matches first, then aliases). */
export function autoMap(meta: Meta, pillar: string, headers: string[]): Record<string, string | null> {
  const cols = importColumns(meta, pillar);
  const used = new Set<string>();
  const out: Record<string, string | null> = {};
  const pass = (pred: (h: string, c: ImportColumn) => boolean) => {
    for (const h of headers) {
      if (out[h]) continue;
      const c = cols.find((col) => !used.has(col.id) && pred(norm(h), col));
      if (c) { out[h] = c.id; used.add(c.id); }
    }
  };
  pass((h, c) => norm(c.label) === h || norm(c.id) === h);
  pass((h, c) => c.aliases.some((a) => norm(a) === h));
  for (const h of headers) if (!(h in out)) out[h] = null;
  return out;
}
