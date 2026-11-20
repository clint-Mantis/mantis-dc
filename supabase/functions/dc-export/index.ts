// dc-export: XLSX exports and import templates.
// POST { project_id, pillars: string[] | 'all', samples_only?: boolean, template?: boolean }
// Data is read through public.dc_list_rows (masks salaries for client viewers) as the calling user.
import ExcelJS from 'npm:exceljs@4.4.0';
import { cors, json, userClient, loadMeta, selectAll } from '../_shared/supa.ts';
import { buildTemplate, buildExport, type ExportSheet } from '../_shared/xlsx.ts';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = userClient(req);
    const body = await req.json();
    const meta = await loadMeta(sb);
    const pillars: string[] = body.pillars === 'all' || !body.pillars ? meta.pillars.map((p) => p.code) : body.pillars;

    if (body.template) {
      let sector: string | null = null;
      if (body.project_id) sector = (await sb.from('dc_projects').select('sector_code').eq('id', body.project_id).single()).data?.sector_code ?? null;
      const bytes = await buildTemplate(ExcelJS, meta, pillars, sector);
      return new Response(bytes as unknown as BodyInit, { headers: { ...cors, 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="dc-template-${pillars.length === 1 ? pillars[0] : 'all'}.xlsx"` } });
    }

    const { data: project, error } = await sb.from('dc_projects').select('id, org_id, title').eq('id', body.project_id).single();
    if (error || !project) return json({ error: 'Project not found' }, 404);
    // masters: full people for roles that may see them, masked view otherwise
    const fullPeople = await sb.from('dc_people').select('id').eq('org_id', project.org_id).limit(1);
    const people = fullPeople.data && fullPeople.data.length
      ? await selectAll(sb, 'dc_people', 'id, surname, first_name, id_number, race_lookup, gender_lookup, nationality_lookup, disabled', ['org_id', project.org_id])
      : await selectAll(sb, 'dc_v_people_masked', 'id, surname, first_name, id_number_masked, race_lookup, gender_lookup, nationality_lookup, disabled', ['org_id', project.org_id]);
    const masters = {
      people,
      suppliers: await selectAll(sb, 'dc_suppliers', '*', ['org_id', project.org_id]),
      beneficiaries: await selectAll(sb, 'dc_beneficiaries', '*', ['org_id', project.org_id]),
      divisions: await selectAll(sb, 'dc_org_divisions', 'id, name', ['org_id', project.org_id]),
    };
    const sheets: ExportSheet[] = [];
    for (const code of pillars) {
      const pl = meta.pillars.find((p) => p.code === code);
      if (!pl) continue;
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 5000) {
        const { data, error: e } = await sb.rpc('dc_list_rows', { p_project: project.id, p_table: pl.table_name, p_offset: offset, p_limit: 5000, p_samples_only: !!body.samples_only });
        if (e) return json({ error: e.message }, 400);
        rows.push(...data.rows);
        if (data.rows.length < 5000) break;
      }
      sheets.push({ pillar: code, rows, masters });
    }
    const bytes = await buildExport(ExcelJS, meta, sheets, project.title);
    const name = `${project.title}-${pillars.length === 1 ? pillars[0] : 'all'}${body.samples_only ? '-samples' : ''}.xlsx`.replace(/[^\w.\- ()]+/g, '_');
    return new Response(bytes as unknown as BodyInit, { headers: { ...cors, 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${name}"` } });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
