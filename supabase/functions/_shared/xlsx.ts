// XLSX templates and exports. Export columns use the same layout as the import template,
// so an exported sheet can be edited and imported again.
import type { Meta, FkTarget } from './engine.ts';
import { importColumns, lookupMap, MASTER_COLUMNS } from './engine.ts';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2F33' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const REQUIRED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB3121B' } };
const MONEY_FMT = '# ##0.00;-# ##0.00';
const SYSTEM_EXPORT = [
  { key: 'verification_status', label: 'Verification status' },
  { key: 'sample_selected', label: 'Sampled' },
  { key: 'source', label: 'Source' },
  { key: 'id', label: 'Row ID (do not edit)' },
];

const safeSheetName = (s: string) => s.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
const colLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// deno-lint-ignore no-explicit-any
function listsSheet(wb: any, meta: Meta) {
  const ws = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const ranges = new Map<string, string>();
  const add = (name: string, values: string[]) => {
    const col = ranges.size + 1;
    ws.getCell(1, col).value = name;
    values.forEach((v, i) => { ws.getCell(i + 2, col).value = v; });
    ranges.set(name, `Lists!$${colLetter(col)}$2:$${colLetter(col)}$${values.length + 1}`);
  };
  add('yesno', ['Yes', 'No']);
  for (const type of [...new Set(meta.lookups.map((l) => l.type))]) {
    add(`lk:${type}`, meta.lookups.filter((l) => l.type === type && l.active !== false).sort((a, b) => a.sort - b.sort).map((l) => l.label));
  }
  for (const d of meta.defs.filter((x) => x.data_type === 'enum')) add(`en:${d.pillar}.${d.key}`, d.enum_labels ?? d.enum_values ?? []);
  return ranges;
}

// deno-lint-ignore no-explicit-any
function pillarColumns(meta: Meta, pillar: string, sector: string | null) {
  const required = new Set(meta.defs.filter((d) => d.pillar === pillar && d.required).map((d) => d.key));
  // fields hidden for this sector in every criteria state are left out of the template
  const sectorHidden = new Set(meta.rules.filter((r) => r.pillar === pillar && !r.visible && !r.criteria_value && !r.criteria_key && r.sector_code === sector).map((r) => r.key));
  return importColumns(meta, pillar).filter((c) => !sectorHidden.has(c.fieldKey)).map((c) => ({ ...c, required: required.has(c.fieldKey) && (c.kind === 'field' || ['surname', 'first_name', 'name'].includes(c.masterKey!)) }));
}

// deno-lint-ignore no-explicit-any
export async function buildTemplate(ExcelJS: any, meta: Meta, pillars: string[], sector: string | null = null): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mantis DC repository';
  const info = wb.addWorksheet('Instructions');
  info.getColumn(1).width = 110;
  [
    'Mantis Networks – B-BBEE data capture import template',
    '',
    'Fill in one row per record on the pillar sheet. Do not rename or reorder the header row.',
    'Red headers are required. Dropdowns show the allowed values (you can also type the code).',
    'Amounts: plain numbers, no currency symbol needed (R 1 234.56 and 1234.56 both work).',
    'Percentages: 0–100 (e.g. 51 for 51%). Dates: YYYY-MM-DD (DD/MM/YYYY is also accepted).',
    'People are matched on ID number, otherwise on surname + first name. New people, suppliers and beneficiaries are created automatically.',
    'POPIA: this file may contain personal information. Store it securely and delete it after importing.',
  ].forEach((t, i) => { info.getCell(i + 1, 1).value = t; if (i === 0) info.getCell(1, 1).font = { bold: true, size: 14 }; });
  const ranges = listsSheet(wb, meta);
  for (const p of pillars) {
    const pl = meta.pillars.find((x) => x.code === p)!;
    const ws = wb.addWorksheet(safeSheetName(pl.label), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    const cols = pillarColumns(meta, p, sector);
    cols.forEach((c, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = c.label;
      cell.fill = c.required ? REQUIRED_FILL : HEADER_FILL;
      cell.font = HEADER_FONT;
      ws.getColumn(i + 1).width = Math.min(Math.max(c.label.length + 2, 12), 40);
      const def = meta.defs.find((d) => d.pillar === p && d.key === c.fieldKey)!;
      let list: string | undefined;
      if (c.kind === 'field') {
        if (def.data_type === 'boolean') list = ranges.get('yesno');
        if (def.data_type === 'lookup') list = ranges.get(`lk:${def.lookup_type}`);
        if (def.data_type === 'enum') list = ranges.get(`en:${p}.${def.key}`);
        if (def.data_type === 'money' || def.data_type === 'money_signed') ws.getColumn(i + 1).numFmt = MONEY_FMT;
        if (def.help) cell.note = def.help;
      } else if (c.masterKey === 'race') list = ranges.get('lk:race');
      else if (c.masterKey === 'gender') list = ranges.get('lk:gender');
      else if (c.masterKey === 'nationality') list = ranges.get('lk:nationality');
      else if (c.masterKey === 'disabled') list = ranges.get('yesno');
      if (list) {
        for (let r = 2; r <= 1001; r++) {
          ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [list], showErrorMessage: false };
        }
      }
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export interface ExportSheet {
  pillar: string;
  rows: Record<string, unknown>[];
  masters: { people: Record<string, unknown>[]; suppliers: Record<string, unknown>[]; beneficiaries: Record<string, unknown>[]; divisions: Record<string, unknown>[] };
}

// deno-lint-ignore no-explicit-any
export async function buildExport(ExcelJS: any, meta: Meta, sheets: ExportSheet[], title: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mantis DC repository';
  wb.title = title;
  const lk = lookupMap(meta.lookups);
  for (const s of sheets) {
    const pl = meta.pillars.find((x) => x.code === s.pillar)!;
    const ws = wb.addWorksheet(safeSheetName(pl.label), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    const cols = pillarColumns(meta, s.pillar, null);
    const all = [...cols.map((c) => ({ label: c.label, c })), ...SYSTEM_EXPORT.map((x) => ({ label: x.label, sys: x.key }))];
    all.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = h.label; cell.fill = HEADER_FILL; cell.font = HEADER_FONT;
      ws.getColumn(i + 1).width = Math.min(Math.max(h.label.length + 2, 12), 40);
    });
    const byId = (t: FkTarget) => new Map((s.masters[t] ?? []).map((m) => [String(m.id), m]));
    const maps = { people: byId('people'), suppliers: byId('suppliers'), beneficiaries: byId('beneficiaries'), divisions: byId('divisions') };
    s.rows.forEach((row, ri) => {
      all.forEach((h, ci) => {
        // deno-lint-ignore no-explicit-any
        const hh = h as any;
        let v: unknown = null;
        if (hh.sys) v = hh.sys === 'sample_selected' ? (row.sample_selected ? 'Yes' : 'No') : row[hh.sys];
        else {
          const c = hh.c;
          const def = meta.defs.find((d) => d.pillar === s.pillar && d.key === c.fieldKey)!;
          const raw = row[c.fieldKey];
          if (c.kind === 'master') {
            const m = raw ? maps[def.fk_target as FkTarget].get(String(raw)) : undefined;
            let mv = m ? m[c.masterKey === 'id_number' && m.id_number_masked !== undefined && m.id_number === undefined ? 'id_number_masked' : c.masterKey] : null;
            if (['race', 'gender', 'nationality'].includes(c.masterKey) && m) mv = lk.get(String(m[`${c.masterKey}_lookup`]))?.label ?? null;
            if (c.masterKey === 'disabled' && m) mv = m.disabled ? 'Yes' : 'No';
            v = mv ?? null;
          } else if (raw === null || raw === undefined) v = null;
          else if (def.data_type === 'boolean') v = raw ? 'Yes' : 'No';
          else if (def.data_type === 'lookup') v = lk.get(String(raw))?.label ?? raw;
          else if (def.data_type === 'enum') { const i = (def.enum_values ?? []).indexOf(String(raw)); v = i >= 0 ? (def.enum_labels?.[i] ?? raw) : raw; }
          else if (['money', 'money_signed', 'percent', 'numeric', 'integer'].includes(def.data_type)) v = Number(raw);
          else v = raw;
          if (def.data_type === 'money' || def.data_type === 'money_signed') ws.getCell(ri + 2, ci + 1).numFmt = MONEY_FMT;
        }
        ws.getCell(ri + 2, ci + 1).value = v as never;
      });
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: all.length } };
  }
  if (!sheets.length) wb.addWorksheet('Empty');
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export const MASTER_TARGETS = Object.keys(MASTER_COLUMNS) as FkTarget[];
