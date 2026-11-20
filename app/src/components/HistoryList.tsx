import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { useMeta } from '../lib/context';
import { lookupMap } from '@engine';
import { Spinner } from './ui';

interface AuditRow { id: number; table_name: string; record_id: string | null; action: string; old: Record<string, unknown> | null; new: Record<string, unknown> | null; changed_by: string | null; changed_at: string }
const HIDE = new Set(['id', 'project_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'org_id', 'import_job_id']);
const TABLE_LABEL: Record<string, string> = {
  dc_projects: 'Project', dc_fin_sheet: 'Financial', dc_fin_history: 'Financial history', dc_fin_sdl_payments: 'SDL payments', dc_own_shareholders: 'Ownership',
  dc_mc_members: 'Management control', dc_sd_interventions: 'Skills development', dc_esd_contributions: 'ESD', dc_proc_suppliers: 'Procurement',
  dc_sed_contributions: 'SED', dc_yes_participants: 'Y.E.S.', dc_evidence_files: 'Evidence', dc_evidence_checklist_items: 'Checklist',
  dc_record_queries: 'Query', dc_pillar_status: 'Pillar lock', dc_project_members: 'Team',
};

/** Who changed which field from what to what (from dc_audit_log). */
export function HistoryList({ projectId, table, recordId, limit = 300 }: { projectId: string; table?: string; recordId?: string; limit?: number }) {
  const meta = useMeta();
  const q = useQuery({
    queryKey: ['history', projectId, table, recordId],
    queryFn: async () => {
      let qb = supabase.from('dc_audit_log').select('*').eq('project_id', projectId).order('changed_at', { ascending: false }).limit(limit);
      if (recordId) qb = qb.eq('record_id', recordId);
      const rows = unwrap(await qb) as AuditRow[];
      const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
      const names = ids.length ? unwrap(await supabase.rpc('dc_user_names', { p_ids: ids })) as { id: string; name: string }[] : [];
      return { rows, names: new Map(names.map((n) => [n.id, n.name])) };
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4 text-sm text-gray-500">History is not available for your role.</div>;
  const lk = meta.data ? lookupMap(meta.data.lookups) : new Map();
  const label = (tbl: string, k: string) => {
    const pillar = meta.data?.pillars.find((p) => p.table_name === tbl)?.code;
    return meta.data?.defs.find((d) => d.pillar === pillar && d.key === k)?.label ?? k.replace(/_/g, ' ');
  };
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '∅';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    const s = String(v);
    return lk.get(s)?.label ?? (s.length > 60 ? s.slice(0, 57) + '…' : s);
  };
  return (
    <ul className="divide-y text-sm">
      {q.data!.rows.map((r) => {
        const keys = Object.keys(r.action === 'delete' ? r.old ?? {} : r.new ?? {}).filter((k) => !HIDE.has(k));
        return (
          <li key={r.id} className="px-4 py-2">
            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              <span>{r.changed_at.slice(0, 19).replace('T', ' ')}</span>
              <span className="font-medium text-ink">{r.changed_by ? q.data!.names.get(r.changed_by) ?? 'User' : 'System'}</span>
              <span className={`badge ${r.action === 'delete' ? 'bg-red-100 text-red-800' : r.action === 'insert' ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>{r.action}</span>
              {!recordId && <span>{TABLE_LABEL[r.table_name] ?? r.table_name}</span>}
            </div>
            {r.action === 'update' ? (
              <ul className="mt-1 space-y-0.5">
                {keys.map((k) => <li key={k}><b>{label(r.table_name, k)}</b>: <span className="text-gray-500 line-through">{show(r.old?.[k])}</span> → {show(r.new?.[k])}</li>)}
              </ul>
            ) : (
              <div className="mt-1 text-xs text-gray-600">{keys.filter((k) => (r.new ?? r.old)?.[k] !== null && (r.new ?? r.old)?.[k] !== false).slice(0, 8).map((k) => `${label(r.table_name, k)}: ${show((r.new ?? r.old)?.[k])}`).join(' · ')}</div>
            )}
          </li>
        );
      })}
      {q.data!.rows.length === 0 && <li className="px-4 py-3 text-gray-500">No changes recorded yet.</li>}
    </ul>
  );
}
