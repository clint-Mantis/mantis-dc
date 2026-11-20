import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { useMeta, can } from '../lib/context';
import { useDashboard, useMasters, useProject, masterLabel, type MasterKind } from '../lib/project';
import { ProjectHeader } from '../components/ProjectHeader';
import { RowPanel } from '../components/RowPanel';
import { Spinner, StatusBadge, ErrorBox } from '../components/ui';
import { formatMoney } from '@engine';

type Row = Record<string, unknown>;

export function SamplesPage() {
  const { projectId } = useParams();
  const meta = useMeta();
  const p = useProject(projectId);
  const d = useDashboard(projectId);
  const role = d.data?.role ?? null;
  const perms = can(role);
  const masters = useMasters(p.data?.org_id, perms.full);
  const [panel, setPanel] = useState<{ pillar: string; table: string; row: Row; tab?: 'details' | 'evidence' | 'queries' | 'history' } | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const q = useQuery({
    queryKey: ['rows', projectId, 'samples'],
    enabled: !!meta.data && !!projectId,
    queryFn: async () => {
      const out: { pillar: string; label: string; table: string; row: Row }[] = [];
      for (const pl of meta.data!.pillars) {
        const r = unwrap(await supabase.rpc('dc_list_rows', { p_project: projectId, p_table: pl.table_name, p_samples_only: true })) as { rows: Row[] };
        out.push(...r.rows.map((row) => ({ pillar: pl.code, label: pl.label, table: pl.table_name, row })));
      }
      return out;
    },
  });
  if (!projectId) return null;
  const summary = (pillar: string, row: Row) => {
    const m = masters.data;
    if (!m) return '';
    const defs = meta.data!.defs.filter((x) => x.pillar === pillar).sort((a, b) => a.sort - b.sort);
    const fk = defs.find((x) => x.data_type === 'fk' && row[x.key]);
    if (fk) return masterLabel(fk.fk_target as MasterKind, (m[fk.fk_target as MasterKind] as Row[]).find((x) => x.id === row[fk.key]));
    if (row.name) return String(row.name);
    const money = defs.find((x) => x.data_type === 'money' && row[x.key]);
    return money ? `${money.label}: ${formatMoney(row[money.key])}` : String(row.description ?? row.id).slice(0, 40);
  };
  const list = (q.data ?? []).filter((x) => !onlyOpen || Number(x.row._open_queries) > 0);
  return (
    <div>
      <ProjectHeader projectId={projectId} />
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Verification samples</h2>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Only rows with open queries</label>
        <span className="text-sm text-gray-500">Select rows to sample on each pillar page{perms.verify ? ', or use “Sample at random”' : ''}.</span>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading || masters.isLoading ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr>{['Pillar', 'Record', 'Status', 'Open queries', 'Evidence', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={String(x.row.id)} className="hover:bg-gray-50">
                  <td className="td">{x.label}</td>
                  <td className="td">{summary(x.pillar, x.row)}</td>
                  <td className="td"><StatusBadge s={String(x.row.verification_status)} /></td>
                  <td className="td">{Number(x.row._open_queries) ? <button className="badge bg-amber-100 text-amber-800" onClick={() => setPanel({ ...x, tab: 'queries' })}>{String(x.row._open_queries)} open</button> : '–'}</td>
                  <td className="td"><button className="text-xs text-brand underline" onClick={() => setPanel({ ...x, tab: 'evidence' })}>{String(x.row._evidence || 'none')}</button></td>
                  <td className="td"><button className="btn btn-sm" onClick={() => setPanel(x)}>Open</button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="td py-6 text-center text-gray-500">No sampled rows yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {panel && p.data && meta.data && masters.data && (
        <RowPanel meta={meta.data} pillar={panel.pillar} table={panel.table} sector={p.data.sector_code} row={panel.row} initialTab={panel.tab}
          project={p.data} role={role} locked={!!d.data?.pillars.find((x) => x.pillar === panel.pillar)?.locked} masters={masters.data}
          onClose={() => setPanel(null)} onSaved={(r) => setPanel({ ...panel, row: { ...panel.row, ...r } })} />
      )}
    </div>
  );
}
