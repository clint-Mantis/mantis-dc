import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RowSelectionState } from '@tanstack/react-table';
import { useApp, useMeta, can } from '../lib/context';
import { useDashboard, useMasters, useProject, type MasterKind } from '../lib/project';
import { supabase, unwrap, callFunction, downloadBlob } from '../lib/supabase';
import { ProjectHeader } from '../components/ProjectHeader';
import { DataGrid } from '../components/DataGrid';
import { RowPanel, RowForm } from '../components/RowPanel';
import { ImportDialog, downloadTemplate } from '../components/ImportDialog';
import { EvidencePanel } from '../components/EvidencePanel';
import { Spinner, ErrorBox, ConfirmTyped, useToast } from '../components/ui';
import { formatMoney, formatNumber, parseNumber, lookupMap, type FieldDef, type Meta } from '@engine';

type Row = Record<string, unknown>;

function toCsv(meta: Meta, pillar: string, rows: Row[], masters: Record<MasterKind, Record<string, unknown>[]>) {
  const lk = lookupMap(meta.lookups);
  const defs = meta.defs.filter((d) => d.pillar === pillar).sort((a, b) => a.sort - b.sort);
  const mm = Object.fromEntries(Object.entries(masters).map(([k, l]) => [k, new Map(l.map((m) => [String(m.id), m]))])) as Record<MasterKind, Map<string, Row>>;
  const cols: { h: string; v: (r: Row) => unknown }[] = [];
  for (const d of defs) {
    if (d.data_type === 'fk') {
      const t = d.fk_target as MasterKind;
      const sub = t === 'people' ? [['surname', 'Surname'], ['first_name', 'First Name'], ['id_number', 'ID Number']] : [['name', t === 'suppliers' ? 'Supplier Name' : t === 'divisions' ? 'Division' : 'Beneficiary Name']];
      if (t === 'suppliers') sub.unshift(['vendor_number', 'Vendor Number']);
      for (const [k, h] of sub) cols.push({ h, v: (r) => { const m = r[d.key] ? mm[t].get(String(r[d.key])) : undefined; return m ? (k === 'id_number' ? m.id_number ?? m.id_number_masked : m[k]) : ''; } });
    } else cols.push({ h: d.label, v: (r) => fmtPlain(d, r[d.key], lk) });
  }
  cols.push({ h: 'Verification status', v: (r) => r.verification_status }, { h: 'Sampled', v: (r) => (r.sample_selected ? 'Yes' : 'No') });
  const esc = (x: unknown) => { const s = x === null || x === undefined ? '' : String(x); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map((c) => esc(c.h)).join(','), ...rows.map((r) => cols.map((c) => esc(c.v(r))).join(','))].join('\r\n');
}
function fmtPlain(d: FieldDef, v: unknown, lk: Map<string, { label: string }>) {
  if (v === null || v === undefined) return '';
  if (d.data_type === 'boolean') return v ? 'Yes' : 'No';
  if (d.data_type === 'lookup') return lk.get(String(v))?.label ?? '';
  if (d.data_type === 'enum') { const i = (d.enum_values ?? []).indexOf(String(v)); return i >= 0 ? d.enum_labels?.[i] ?? v : v; }
  return v;
}

export function PillarPage() {
  const { projectId, pillar } = useParams();
  const meta = useMeta();
  if (!projectId || !pillar) return null;
  return (
    <div>
      <ProjectHeader projectId={projectId} />
      {!meta.data ? <Spinner /> : pillar === 'financial' ? <FinancialView projectId={projectId} /> : <ListPillar key={pillar} projectId={projectId} pillar={pillar} />}
    </div>
  );
}

function ListPillar({ projectId, pillar }: { projectId: string; pillar: string }) {
  const { me } = useApp();
  const meta = useMeta().data!;
  const p = useProject(projectId);
  const d = useDashboard(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const role = d.data?.role ?? null;
  const perms = can(role);
  const pl = meta.pillars.find((x) => x.code === pillar)!;
  const card = d.data?.pillars.find((x) => x.pillar === pillar);
  const locked = !!card?.locked;
  const masters = useMasters(p.data?.org_id, perms.full);
  const rows = useQuery({
    queryKey: ['rows', projectId, pl.table_name],
    queryFn: async () => unwrap(await supabase.rpc('dc_list_rows', { p_project: projectId, p_table: pl.table_name, p_offset: 0, p_limit: 20000 })) as { total: number; rows: Row[] },
  });
  const [panel, setPanel] = useState<{ row: Row | null; tab?: 'details' | 'evidence' | 'queries' | 'history' } | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sampleN, setSampleN] = useState(5);
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const canWrite = perms.capture && (!locked || perms.manage);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['rows', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard', projectId] }); };
  const runRpc = async (label: string, fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, okMsg: (d: unknown) => string) => {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (r.error) toast(r.error.message, 'error'); else { toast(okMsg(r.data)); refresh(); setSelection({}); }
  };
  const doDelete = async (ids: string[]) => {
    setBusy('delete');
    const r = await supabase.from(pl.table_name).delete().in('id', ids).select('id');
    setBusy(null); setConfirmDelete(null);
    if (r.error) toast(r.error.message, 'error');
    else { toast(`${r.data.length} row(s) deleted${r.data.length < ids.length ? ` – ${ids.length - r.data.length} locked or not permitted` : ''}`); setSelection({}); refresh(); }
  };
  const exportXlsx = async (samplesOnly: boolean) => {
    setBusy('xlsx');
    try { downloadBlob(await callFunction<Blob>('dc-export', { project_id: projectId, pillars: [pillar], samples_only: samplesOnly }, true), `${p.data?.title} – ${pl.label}${samplesOnly ? ' – samples' : ''}.xlsx`); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const exportCsv = () => {
    const data = selectedIds.length ? rows.data!.rows.filter((r) => selectedIds.includes(String(r.id))) : rows.data!.rows;
    downloadBlob(new Blob([toCsv(meta, pillar, data, masters.data!)], { type: 'text/csv;charset=utf-8' }), `${p.data?.title} – ${pl.label}.csv`);
  };
  const onOpen = useCallback((row: Row, tab?: 'details' | 'evidence' | 'queries' | 'history') => setPanel({ row, tab }), []);
  const onDeleteOne = useCallback((row: Row) => setConfirmDelete([String(row.id)]), []);
  const actions = useMemo(() => ({ onOpen, onDelete: onDeleteOne }), [onOpen, onDeleteOne]);
  const mastersData = masters.data ?? { people: [], suppliers: [], beneficiaries: [], divisions: [] };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold">{pl.label}</h2>
        {locked && <span className="badge bg-gray-700 text-white">Locked{perms.manage ? ' – you can still edit as consultant' : ''}</span>}
        {canWrite && <button className="btn-primary" onClick={() => setPanel({ row: null })}>+ Add</button>}
        {canWrite && <button className="btn" onClick={() => setImporting(true)}>Import</button>}
        <button className="btn" onClick={exportCsv} disabled={!rows.data || !masters.data}>Export CSV{selectedIds.length ? ' (selected)' : ''}</button>
        <button className="btn" onClick={() => exportXlsx(false)} disabled={busy === 'xlsx'}>Export XLSX</button>
        {card?.sampled ? <button className="btn" onClick={() => exportXlsx(true)} disabled={busy === 'xlsx'}>Export samples</button> : null}
        {perms.capture && <button className="btn" onClick={() => downloadTemplate(projectId, pillar, pl.label).catch((e) => toast(e.message, 'error'))}>Template</button>}
        {canWrite && selectedIds.length > 0 && <button className="btn-danger" onClick={() => setConfirmDelete(selectedIds)}>Delete selected ({selectedIds.length})</button>}
        {perms.capture && selectedIds.length > 0 && rows.data?.rows.some((r) => selectedIds.includes(String(r.id)) && !r.confirmed) && (
          <button className="btn" onClick={() => runRpc('confirm', () => supabase.rpc('dc_confirm_rows', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds }), (n) => `${n} row(s) confirmed`)}>Confirm carried-forward</button>
        )}
      </div>
      {perms.verify && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <b className="mr-1">Verification</b>
          <button className="btn btn-sm" disabled={!selectedIds.length || !!busy} onClick={() => runRpc('s', () => supabase.rpc('dc_set_sample', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds, p_selected: true }), (n) => `${n} row(s) sampled`)}>Sample selected</button>
          <button className="btn btn-sm" disabled={!selectedIds.length || !!busy} onClick={() => runRpc('u', () => supabase.rpc('dc_set_sample', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds, p_selected: false }), (n) => `${n} row(s) unsampled`)}>Unsample</button>
          <span className="ml-2">Random</span><input type="number" min={1} className="input w-16" value={sampleN} onChange={(e) => setSampleN(Number(e.target.value))} aria-label="Random sample size" />
          <button className="btn btn-sm" disabled={!!busy} onClick={() => runRpc('r', () => supabase.rpc('dc_random_sample', { p_project: projectId, p_pillar: pillar, p_n: sampleN }), (n) => `${n} random row(s) sampled`)}>Sample at random</button>
          <span className="mx-2 h-4 border-l border-blue-200" />
          <button className="btn btn-sm" disabled={!selectedIds.length || !!busy} onClick={() => runRpc('v', () => supabase.rpc('dc_set_verification', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds, p_status: 'verified' }), (n) => `${n} row(s) verified`)}>Mark verified</button>
          <button className="btn btn-sm" disabled={!selectedIds.length || !!busy} onClick={() => runRpc('x', () => supabase.rpc('dc_set_verification', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds, p_status: 'rejected' }), (n) => `${n} row(s) rejected`)}>Mark rejected</button>
          <button className="btn btn-sm" disabled={!selectedIds.length || !!busy} onClick={() => runRpc('l', () => supabase.rpc('dc_set_row_lock', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds, p_locked: true }), (n) => `${n} row(s) locked`)}>Lock rows</button>
          <button className="btn btn-sm" disabled={!selectedIds.length || !!busy} onClick={() => runRpc('ul', () => supabase.rpc('dc_set_row_lock', { p_project: projectId, p_table: pl.table_name, p_ids: selectedIds, p_locked: false }), (n) => `${n} row(s) unlocked`)}>Unlock rows</button>
        </div>
      )}
      <ErrorBox error={rows.error || masters.error} />
      {rows.isLoading || masters.isLoading || !p.data ? <Spinner /> : (
        <DataGrid meta={meta} pillar={pillar} rows={rows.data!.rows} masters={mastersData}
          storageKey={`dc-cols:${me?.user_id}:${pillar}`} actions={actions} selection={selection} onSelection={setSelection}
          canSelect={perms.capture || perms.verify} canDelete={canWrite} />
      )}
      <details className="card">
        <summary className="cursor-pointer px-4 py-2 font-semibold">Pillar evidence ({card?.evidence_outstanding ?? 0} checklist items outstanding)</summary>
        <EvidencePanel projectId={projectId} orgId={p.data?.org_id} pillar={pillar} role={role} locked={locked} />
      </details>
      {panel && p.data && (
        <RowPanel meta={meta} pillar={pillar} table={pl.table_name} sector={p.data.sector_code} row={panel.row} initialTab={panel.tab}
          project={p.data} role={role} locked={locked} masters={mastersData}
          onClose={() => setPanel(null)} onSaved={(r) => setPanel({ row: { ...(panel.row ?? {}), ...r }, tab: 'details' })} />
      )}
      {importing && <ImportDialog projectId={projectId} pillar={pillar} pillarLabel={pl.label} onClose={() => setImporting(false)} />}
      {confirmDelete && <ConfirmTyped title="Delete rows" busy={busy === 'delete'} onClose={() => setConfirmDelete(null)} onConfirm={() => doDelete(confirmDelete)}
        message={<>This permanently deletes <b>{confirmDelete.length}</b> row(s) from {pl.label}. Evidence linked to these rows stays on the project. The deletion is recorded in the audit log.</>} />}
    </div>
  );
}

// ---------------------------------------------------------------- Financial (single record + mini grids)
function FinancialView({ projectId }: { projectId: string }) {
  const meta = useMeta().data!;
  const p = useProject(projectId);
  const d = useDashboard(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const role = d.data?.role ?? null;
  const perms = can(role);
  const locked = !!d.data?.pillars.find((x) => x.pillar === 'financial')?.locked;
  const disabled = !perms.capture || (locked && !perms.manage);
  const masters = useMasters(p.data?.org_id, perms.full);
  const q = useQuery({
    queryKey: ['rows', projectId, 'financial'],
    queryFn: async () => {
      const [s, h, m] = await Promise.all([
        supabase.rpc('dc_list_rows', { p_project: projectId, p_table: 'dc_fin_sheet' }),
        supabase.rpc('dc_list_rows', { p_project: projectId, p_table: 'dc_fin_history' }),
        supabase.rpc('dc_list_rows', { p_project: projectId, p_table: 'dc_fin_sdl_payments' }),
      ]);
      return {
        sheet: (unwrap(s) as { rows: Row[] }).rows[0] ?? null,
        history: ((unwrap(h) as { rows: Row[] }).rows).sort((a, b) => Number(a.year_offset) - Number(b.year_offset)),
        sdl: ((unwrap(m) as { rows: Row[] }).rows).sort((a, b) => Number(a.month_no) - Number(b.month_no)),
      };
    },
  });
  const [hist, setHist] = useState<Record<string, { npat?: number | null; turnover?: number | null }>>({});
  const [sdl, setSdl] = useState<Record<string, number | null>>({});
  const saveSheet = async (values: Row) => {
    const sheet = q.data!.sheet;
    if (sheet) unwrap(await supabase.from('dc_fin_sheet').update(values).eq('id', String(sheet.id)));
    else unwrap(await supabase.from('dc_fin_sheet').insert({ ...values, project_id: projectId }));
    for (const [id, v] of Object.entries(hist)) unwrap(await supabase.from('dc_fin_history').update(v).eq('id', id));
    for (const [id, amount] of Object.entries(sdl)) unwrap(await supabase.from('dc_fin_sdl_payments').update({ amount }).eq('id', id));
    setHist({}); setSdl({});
    qc.invalidateQueries({ queryKey: ['rows', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard', projectId] });
    toast('Financial data saved');
  };
  if (q.isLoading || !p.data || masters.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const sheet = q.data!.sheet ?? {};
  const initial: Row = {};
  for (const def of meta.defs.filter((x) => x.pillar === 'financial')) initial[def.key] = sheet[def.key] ?? null;
  const fy = Number(p.data.fy_end.slice(0, 4));
  const monthName = (n: number) => new Date(Date.UTC(fy - 1, Number(p.data!.period_start.slice(5, 7)) - 1 + n - 1, 1)).toLocaleString('en-ZA', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const sdlTotal = q.data!.sdl.reduce((a, r) => a + Number(sdl[String(r.id)] ?? r.amount ?? 0), 0);
  const numCell = (val: unknown, onChange: (n: number | null) => void, label: string) => (
    <input className="input text-right" aria-label={label} disabled={disabled} defaultValue={val === null || val === undefined ? '' : formatNumber(val, 2)}
      onBlur={(e) => { const n = parseNumber(e.target.value); if (n !== null && Number.isNaN(n)) { toast(`${label}: not a number`, 'error'); return; } onChange(n); }} />
  );
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_420px]">
      <div className="card min-h-[400px]">
        <div className="border-b px-4 py-2 font-semibold">Financial information {locked && <span className="badge ml-2 bg-gray-700 text-white">Locked</span>}</div>
        <RowForm meta={meta} pillar="financial" sector={p.data.sector_code} initial={initial} masters={masters.data!} orgId={p.data.org_id}
          disabled={disabled} canEditMasters={false} onSubmit={async (v) => { try { await saveSheet(v); } catch (e) { toast((e as Error).message, 'error'); } }} submitLabel="Save financial data" />
      </div>
      <div className="space-y-3">
        <div className="card">
          <div className="border-b px-4 py-2 font-semibold">History (prior years)</div>
          <table className="w-full"><thead><tr><th className="th">Year</th><th className="th text-right">NPAT</th><th className="th text-right">Turnover</th></tr></thead>
            <tbody>{q.data!.history.map((r) => (
              <tr key={String(r.id)}>
                <td className="td whitespace-nowrap">Current year −{String(r.year_offset)}</td>
                <td className="td">{numCell(r.npat, (n) => setHist((h) => ({ ...h, [String(r.id)]: { ...h[String(r.id)], npat: n } })), `NPAT year -${r.year_offset}`)}</td>
                <td className="td">{numCell(r.turnover, (n) => setHist((h) => ({ ...h, [String(r.id)]: { ...h[String(r.id)], turnover: n } })), `Turnover year -${r.year_offset}`)}</td>
              </tr>
            ))}</tbody></table>
        </div>
        <div className="card">
          <div className="border-b px-4 py-2 font-semibold">SDL payments (1% skills levy)</div>
          <table className="w-full"><thead><tr><th className="th">Month</th><th className="th text-right">Amount (R)</th></tr></thead>
            <tbody>{q.data!.sdl.map((r) => (
              <tr key={String(r.id)}><td className="td">{monthName(Number(r.month_no))}</td>
                <td className="td">{numCell(r.amount, (n) => setSdl((s) => ({ ...s, [String(r.id)]: n })), `SDL month ${r.month_no}`)}</td></tr>
            ))}
              <tr><td className="td font-semibold">Total</td><td className="td text-right font-semibold">{formatMoney(sdlTotal)}</td></tr>
            </tbody></table>
          {(Object.keys(hist).length > 0 || Object.keys(sdl).length > 0) && <p className="px-4 py-2 text-xs text-amber-700">Unsaved changes – click “Save financial data”.</p>}
        </div>
        <div className="card">
          <div className="border-b px-4 py-2 font-semibold">Financial evidence</div>
          <EvidencePanel projectId={projectId} orgId={p.data.org_id} pillar="financial" role={role} locked={locked} />
        </div>
      </div>
    </div>
  );
}
