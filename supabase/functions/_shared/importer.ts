// Import pipeline: parse CSV/XLSX -> map headers -> coerce -> resolve masters -> validate.
// Runtime-agnostic: the caller passes in the ExcelJS module (npm:exceljs in Deno, exceljs in Node).
import type { Meta, FieldDef, FkTarget, CellIn, RowError } from './engine.ts';
import { coerce, validateRow, importColumns, norm, parseBool, saIdValid, saIdDob, ageAt } from './engine.ts';

export interface ParsedSheet { headers: string[]; rows: CellIn[][] }

// ---------------------------------------------------------------- parsing
export function parseCsv(text: string): ParsedSheet {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty.map((r) => headers.map((_, i) => ({ value: r[i] ?? null }))) };
}

// deno-lint-ignore no-explicit-any
export async function parseXlsx(ExcelJS: any, bytes: ArrayBuffer | Uint8Array, sheetName?: string): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  // deno-lint-ignore no-explicit-any
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets.find((w: any) => w.state !== 'hidden' && w.name !== 'Instructions' && w.name !== 'Lists') || wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  let headerRow = 0;
  const rows: CellIn[][] = [];
  let headers: string[] = [];
  // deno-lint-ignore no-explicit-any
  ws.eachRow({ includeEmpty: false }, (r: any, n: number) => {
    // deno-lint-ignore no-explicit-any
    const vals: any[] = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(r.getCell(c));
    if (!headerRow) {
      // deno-lint-ignore no-explicit-any
      headers = vals.map((cell: any) => cellText(cell.value).trim());
      if (headers.some((h) => h)) headerRow = n;
      return;
    }
    // deno-lint-ignore no-explicit-any
    rows.push(vals.slice(0, headers.length).map((cell: any) => ({
      value: cellValue(cell.value),
      isPercentFormat: typeof cell.numFmt === 'string' && cell.numFmt.includes('%'),
    })));
  });
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  return { headers, rows: rows.filter((r) => r.some((c) => c.value !== null && c.value !== '')) };
}
// deno-lint-ignore no-explicit-any
function cellValue(v: any): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? null;            // formula
    if ('richText' in v) return v.richText.map((t: { text: string }) => t.text).join('');
    if ('text' in v) return v.text;                          // hyperlink
    if ('error' in v) return null;
  }
  return v;
}
function cellText(v: unknown): string { const x = cellValue(v); return x === null ? '' : String(x); }

// ---------------------------------------------------------------- masters
export interface Masters {
  people: { id: string; surname: string; first_name: string; id_number: string | null }[];
  suppliers: { id: string; name: string; vendor_number: string | null }[];
  beneficiaries: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
}
export interface MasterRef { target: FkTarget; existingId?: string; create?: Record<string, unknown>; key: string }
export interface BuiltRow { rowNo: number; values: Record<string, unknown>; masters: Record<string, MasterRef>; errors: RowError[] }

function masterKey(target: FkTarget, rec: Record<string, unknown>): string {
  const s = (k: string) => norm(String(rec[k] ?? ''));
  switch (target) {
    case 'people': return rec.id_number ? `id:${String(rec.id_number).replace(/\s/g, '')}` : `n:${s('surname')}|${s('first_name')}`;
    case 'suppliers': return rec.vendor_number ? `v:${s('vendor_number')}` : `n:${s('name')}`;
    default: return `n:${s('name')}`;
  }
}

function resolveMaster(meta: Meta, target: FkTarget, rec: Record<string, unknown>, masters: Masters): { ref?: MasterRef; errors: string[] } {
  const errors: string[] = [];
  const has = (k: string) => rec[k] !== null && rec[k] !== undefined && String(rec[k]).trim() !== '';
  if (!Object.keys(rec).some(has)) return { errors };
  if (target === 'people') {
    const idn = has('id_number') ? String(rec.id_number).replace(/\s/g, '') : null;
    const byId = idn ? masters.people.find((p) => p.id_number === idn) : undefined;
    const byName = masters.people.find((p) => norm(p.surname) === norm(String(rec.surname ?? '')) && norm(p.first_name) === norm(String(rec.first_name ?? '')) && (!idn || !p.id_number));
    const hit = byId ?? byName;
    if (hit) return { ref: { target, existingId: hit.id, key: masterKey(target, rec) }, errors };
    if (!has('surname') || !has('first_name')) errors.push('Surname and first name are needed to add a new person');
    const create: Record<string, unknown> = { surname: rec.surname, first_name: rec.first_name, id_number: idn };
    const lk = (type: string, raw: unknown) => {
      if (!raw) return null;
      const opts = meta.lookups.filter((l) => l.type === type);
      const s = norm(String(raw));
      const h = opts.find((l) => norm(l.code) === s || norm(l.label) === s);
      if (!h) errors.push(`"${raw}" is not a valid ${type} (${opts.map((o) => o.label).join(', ')})`);
      return h?.id ?? null;
    };
    create.race_lookup = lk('race', rec.race);
    create.gender_lookup = lk('gender', rec.gender);
    create.nationality_lookup = lk('nationality', rec.nationality);
    const dis = parseBool(rec.disabled);
    if (dis === 'invalid') errors.push(`Disabled: "${rec.disabled}" is not Yes/No`); else if (dis !== null) create.disabled = dis;
    const fn = meta.lookups.find((l) => l.id === create.nationality_lookup)?.code === 'FN';
    if (idn && !fn && !saIdValid(idn)) errors.push(`ID number ${idn.slice(0, 2)}…${idn.slice(-2)} fails the SA ID checksum`);
    return { ref: { target, create, key: masterKey(target, rec) }, errors };
  }
  if (target === 'suppliers') {
    const v = has('vendor_number') ? norm(String(rec.vendor_number)) : null;
    const hit = (v && masters.suppliers.find((x) => x.vendor_number && norm(x.vendor_number) === v))
      || masters.suppliers.find((x) => has('name') && norm(x.name) === norm(String(rec.name)));
    if (hit) return { ref: { target, existingId: hit.id, key: masterKey(target, rec) }, errors };
    if (!has('name')) errors.push('Supplier name is needed to add a new supplier');
    const create: Record<string, unknown> = {};
    for (const k of ['vendor_number', 'name', 'reg_no', 'vat_no', 'contact_person', 'tel', 'email']) if (has(k)) create[k] = String(rec[k]).trim();
    return { ref: { target, create, key: masterKey(target, rec) }, errors };
  }
  const list = target === 'beneficiaries' ? masters.beneficiaries : masters.divisions;
  const hit = list.find((x) => has('name') && norm(x.name) === norm(String(rec.name)));
  if (hit) return { ref: { target, existingId: hit.id, key: masterKey(target, rec) }, errors };
  if (!has('name')) errors.push('A name is needed');
  const create: Record<string, unknown> = { name: String(rec.name ?? '').trim() };
  if (target === 'beneficiaries' && has('reg_no')) create.reg_no = String(rec.reg_no).trim();
  return { ref: { target, create, key: masterKey(target, rec) }, errors };
}

/** Build typed rows from a parsed sheet and a header -> column-id map. */
export function buildRows(meta: Meta, pillar: string, sector: string, periodStart: string, sheet: ParsedSheet,
                          map: Record<string, string | null>, masters: Masters): BuiltRow[] {
  const cols = importColumns(meta, pillar);
  const defs = new Map<string, FieldDef>(meta.defs.filter((d) => d.pillar === pillar).map((d) => [d.key, d]));
  const colIdx = sheet.headers.map((h) => (map[h] ? cols.find((c) => c.id === map[h]) ?? null : null));
  const out: BuiltRow[] = [];
  sheet.rows.forEach((cells, i) => {
    const values: Record<string, unknown> = {};
    const masterRecs: Record<string, Record<string, unknown>> = {};
    const errors: RowError[] = [];
    cells.forEach((cell, ci) => {
      const col = colIdx[ci];
      if (!col) return;
      if (col.kind === 'master') {
        (masterRecs[col.fieldKey] ??= {})[col.masterKey!] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.value;
        return;
      }
      const def = defs.get(col.fieldKey)!;
      const r = coerce(meta, def, cell);
      if (r.error) errors.push({ column: def.key, message: `${def.label}: ${r.error}` });
      if (r.value !== undefined) values[def.key] = r.value;
    });
    const refs: Record<string, MasterRef> = {};
    for (const [fieldKey, rec] of Object.entries(masterRecs)) {
      const def = defs.get(fieldKey)!;
      const { ref, errors: me } = resolveMaster(meta, def.fk_target!, rec, masters);
      me.forEach((m) => errors.push({ column: fieldKey, message: `${def.label}: ${m}` }));
      if (ref) { refs[fieldKey] = ref; values[fieldKey] = ref.existingId ?? `new:${ref.key}`; }
    }
    // procurement defaults from ownership percentages (only when the flag was not supplied)
    if (pillar === 'procurement') {
      const bo = values.black_owned_pct as number | null | undefined; const bwo = values.bwo_pct as number | null | undefined;
      if (values.black_owned_51 === undefined && typeof bo === 'number') values.black_owned_51 = bo >= 51;
      if (values.bwo_35 === undefined && typeof bwo === 'number') values.bwo_35 = bwo >= 35;
      if (values.bwo_51 === undefined && typeof bwo === 'number') values.bwo_51 = bwo >= 51;
    }
    const v = validateRow(meta, pillar, sector, values);
    for (const e of v) if (!errors.some((x) => x.column === e.column)) errors.push(e);
    // Y.E.S. age at start date
    if (pillar === 'yes' && refs.person_id) {
      const idn = refs.person_id.create?.id_number as string | undefined
        ?? masters.people.find((p) => p.id === refs.person_id.existingId)?.id_number ?? undefined;
      const dob = idn ? saIdDob(idn) : null;
      if (dob) {
        const age = ageAt(dob, String(values.start_date ?? periodStart));
        if (age < 18 || age > 35) errors.push({ column: 'person_id', message: `Y.E.S. participants must be 18–35 at start date (this person is ${age})` });
      }
    }
    out.push({ rowNo: i + 2, values, masters: refs, errors });
  });
  return out;
}

/** Unique masters that must be created before the rows can be committed. */
export function mastersToCreate(rows: BuiltRow[]): MasterRef[] {
  const seen = new Map<string, MasterRef>();
  for (const r of rows) for (const ref of Object.values(r.masters)) {
    if (ref.create && !seen.has(`${ref.target}|${ref.key}`)) seen.set(`${ref.target}|${ref.key}`, ref);
  }
  return [...seen.values()];
}
