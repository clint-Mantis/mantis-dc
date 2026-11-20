// dc-import: CSV / XLSX import for one pillar of a project.
// POST { action: 'parse' | 'validate' | 'commit', job_id, column_map?, mode? }
// The file is uploaded by the app to storage bucket dc-imports first, and a dc_import_jobs row created.
// Everything runs as the calling user (RLS applies).
import ExcelJS from 'npm:exceljs@4.4.0';
import { cors, json, userClient, loadMeta, selectAll } from '../_shared/supa.ts';
import { autoMap, importColumns } from '../_shared/engine.ts';
import { parseCsv, parseXlsx, buildRows, mastersToCreate, type Masters, type ParsedSheet } from '../_shared/importer.ts';

const MASTER_TABLE = { people: 'dc_people', suppliers: 'dc_suppliers', beneficiaries: 'dc_beneficiaries', divisions: 'dc_org_divisions' } as const;
const safeSheetName = (s: string) => s.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = userClient(req);
    const { action, job_id, column_map, mode } = await req.json();
    const { data: job, error: jobErr } = await sb.from('dc_import_jobs').select('*').eq('id', job_id).single();
    if (jobErr || !job) return json({ error: 'Import job not found or you do not have capture access' }, 404);
    const { data: project, error: pErr } = await sb.from('dc_projects').select('id, org_id, sector_code, period_start').eq('id', job.project_id).single();
    if (pErr || !project) return json({ error: 'Project not found' }, 404);
    const meta = await loadMeta(sb);
    const pillar = meta.pillars.find((p) => p.code === job.pillar)!;

    // ---- read and parse the uploaded file
    const { data: blob, error: dlErr } = await sb.storage.from('dc-imports').download(job.file_path);
    if (dlErr || !blob) return json({ error: `Could not read the uploaded file: ${dlErr?.message}` }, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let sheet: ParsedSheet;
    if (/\.csv$/i.test(job.file_path) || /\.csv$/i.test(job.file_name ?? '')) sheet = parseCsv(new TextDecoder().decode(bytes));
    else sheet = await parseXlsx(ExcelJS, bytes, safeSheetName(pillar.label));
    if (!sheet.headers.length) return json({ error: 'The file has no header row' }, 400);
    if (sheet.rows.length > 20000) return json({ error: 'Imports are limited to 20 000 rows per file' }, 400);

    if (action === 'parse') {
      const map = autoMap(meta, job.pillar, sheet.headers);
      await sb.from('dc_import_jobs').update({ total_rows: sheet.rows.length, column_map: map }).eq('id', job.id);
      return json({
        headers: sheet.headers,
        sample: sheet.rows.slice(0, 10).map((r) => r.map((c) => (c.value instanceof Date ? c.value.toISOString().slice(0, 10) : c.value))),
        total_rows: sheet.rows.length,
        suggested_map: map,
        columns: importColumns(meta, job.pillar).map((c) => ({ id: c.id, label: c.label })),
      });
    }

    // ---- validate (also the first step of commit)
    const map: Record<string, string | null> = column_map ?? job.column_map ?? autoMap(meta, job.pillar, sheet.headers);
    const fkTargets = new Set(meta.defs.filter((d) => d.pillar === job.pillar && d.fk_target).map((d) => d.fk_target!));
    const masters: Masters = { people: [], suppliers: [], beneficiaries: [], divisions: [] };
    if (fkTargets.has('people')) masters.people = await selectAll(sb, 'dc_people', 'id, surname, first_name, id_number', ['org_id', project.org_id]) as Masters['people'];
    if (fkTargets.has('suppliers')) masters.suppliers = await selectAll(sb, 'dc_suppliers', 'id, name, vendor_number', ['org_id', project.org_id]) as Masters['suppliers'];
    if (fkTargets.has('beneficiaries')) masters.beneficiaries = await selectAll(sb, 'dc_beneficiaries', 'id, name', ['org_id', project.org_id]) as Masters['beneficiaries'];
    if (fkTargets.has('divisions')) masters.divisions = await selectAll(sb, 'dc_org_divisions', 'id, name', ['org_id', project.org_id]) as Masters['divisions'];

    const rows = buildRows(meta, job.pillar, project.sector_code, project.period_start, sheet, map, masters);
    const bad = rows.filter((r) => r.errors.length);
    const errorRows = bad.slice(0, 1000).map((r) => ({ row: r.rowNo, errors: r.errors }));
    const toCreate = mastersToCreate(rows.filter((r) => !r.errors.length));

    if (action === 'validate') {
      await sb.from('dc_import_jobs').update({
        status: 'validated', column_map: map, total_rows: rows.length, valid_rows: rows.length - bad.length, error_rows: errorRows,
      }).eq('id', job.id);
      return json({
        total_rows: rows.length, valid_rows: rows.length - bad.length, error_rows: errorRows,
        new_masters: toCreate.reduce((a, m) => ({ ...a, [m.target]: (a[m.target as keyof typeof a] ?? 0) + 1 }), {} as Record<string, number>),
        preview: rows.slice(0, 20).map((r) => ({ row: r.rowNo, values: r.values, errors: r.errors })),
      });
    }

    if (action === 'commit') {
      const m = mode === 'all_or_nothing' ? 'all_or_nothing' : 'valid_only';
      if (m === 'all_or_nothing' && bad.length) return json({ error: `${bad.length} row(s) have errors; fix them or import valid rows only`, error_rows: errorRows }, 400);
      const good = rows.filter((r) => !r.errors.length);
      if (!good.length) return json({ error: 'There are no valid rows to import' }, 400);
      // create the master records the rows need (people, suppliers, beneficiaries, divisions)
      const created = new Map<string, string>();
      for (const target of ['people', 'suppliers', 'beneficiaries', 'divisions'] as const) {
        const list = toCreate.filter((x) => x.target === target);
        for (let i = 0; i < list.length; i += 500) {
          const chunk = list.slice(i, i + 500);
          const { data, error } = await sb.from(MASTER_TABLE[target])
            .insert(chunk.map((x) => ({ ...x.create, org_id: project.org_id }))).select('id');
          if (error) return json({ error: `Could not create ${target}: ${error.message}` }, 400);
          chunk.forEach((x, k) => created.set(`new:${x.key}`, (data as { id: string }[])[k].id));
        }
      }
      const payload = good.map((r) => {
        const v: Record<string, unknown> = { _row: r.rowNo };
        for (const [k, val] of Object.entries(r.values)) v[k] = typeof val === 'string' && val.startsWith('new:') ? created.get(val) ?? null : val;
        return v;
      });
      let committed = 0; const dbErrors: unknown[] = [];
      if (m === 'all_or_nothing') {
        const { data, error } = await sb.rpc('dc_import_commit', { p_job: job.id, p_rows: payload, p_mode: m });
        if (error) return json({ error: `Import rolled back: ${error.message}` }, 400);
        committed = data.committed;
      } else {
        // one RPC (one transaction) for the whole file; rows the database rejects are reported back
        const { data, error } = await sb.rpc('dc_import_commit', { p_job: job.id, p_rows: payload, p_mode: m });
        if (error) return json({ error: error.message }, 400);
        committed = data.committed; dbErrors.push(...(data.errors ?? []));
      }
      return json({ committed, skipped: bad.length + dbErrors.length, error_rows: errorRows, db_errors: dbErrors, created_masters: created.size });
    }
    return json({ error: `Unknown action ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
