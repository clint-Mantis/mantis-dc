import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useDashboard, useProject } from '../lib/project';
import { can } from '../lib/context';
import { supabase, unwrap, callFunction, downloadBlob } from '../lib/supabase';
import { ProjectHeader } from '../components/ProjectHeader';
import { Spinner, ErrorBox, useToast } from '../components/ui';
import { EvidencePanel } from '../components/EvidencePanel';

export function DashboardPage() {
  const { projectId } = useParams();
  const d = useDashboard(projectId);
  const p = useProject(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const role = d.data?.role;
  const perms = can(role);

  const toggleLock = async (pillar: string, locked: boolean) => {
    try {
      unwrap(await supabase.rpc('dc_set_pillar_lock', { p_project: projectId, p_pillar: pillar, p_locked: !locked }));
      qc.invalidateQueries({ queryKey: ['dashboard', projectId] });
      toast(!locked ? 'Pillar locked' : 'Pillar unlocked');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const setStatus = async (status: string) => {
    try {
      unwrap(await supabase.from('dc_projects').update({ status }).eq('id', projectId!));
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const exportAll = async () => {
    setBusy(true);
    try { downloadBlob(await callFunction<Blob>('dc-export', { project_id: projectId, pillars: 'all' }, true), `${p.data?.title ?? 'project'} – all pillars.xlsx`); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  if (!projectId) return null;
  return (
    <div>
      <ProjectHeader projectId={projectId} />
      <ErrorBox error={d.error} />
      {d.isLoading ? <Spinner /> : d.data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn" onClick={exportAll} disabled={busy}>{busy ? 'Exporting…' : 'Export all pillars (XLSX)'}</button>
            {perms.manage && (
              <label className="flex items-center gap-2 text-sm">Status
                <select className="input w-44" value={p.data?.status ?? ''} onChange={(e) => setStatus(e.target.value)}>
                  {['draft', 'capturing', 'in_verification', 'verified', 'archived'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select></label>
            )}
            <div className="ml-auto text-sm text-gray-600">
              Evidence: <b>{d.data.checklist.accepted}</b> of <b>{d.data.checklist.total}</b> accepted · {d.data.checklist.outstanding} outstanding
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {d.data.pillars.map((c) => (
              <div key={c.pillar} className={`card flex flex-col p-4 ${c.locked ? 'border-gray-400 bg-gray-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/p/${projectId}/pillar/${c.pillar}`} className="font-semibold text-ink hover:text-brand hover:underline">{c.label}</Link>
                  {c.locked && <span className="badge bg-gray-700 text-white">Locked</span>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-y-0.5 text-sm">
                  <dt className="text-gray-500">{c.mode === 'single' ? 'Record' : 'Rows captured'}</dt><dd className="text-right font-medium">{c.mode === 'single' ? (c.rows ? 'Yes' : '–') : c.rows}</dd>
                  <dt className="text-gray-500">Missing required</dt><dd className={`text-right font-medium ${c.rows_missing_required ? 'text-red-700' : ''}`}>{c.rows_missing_required}</dd>
                  <dt className="text-gray-500">Evidence outstanding</dt><dd className={`text-right font-medium ${c.evidence_outstanding ? 'text-amber-700' : 'text-green-700'}`}>{c.evidence_outstanding} / {c.evidence_total}</dd>
                  <dt className="text-gray-500">Open queries</dt><dd className={`text-right font-medium ${c.open_queries ? 'text-amber-700' : ''}`}>{c.open_queries}</dd>
                  {c.unconfirmed > 0 && <><dt className="text-gray-500">Carried forward – to confirm</dt><dd className="text-right font-medium text-blue-700">{c.unconfirmed}</dd></>}
                  {c.sampled > 0 && <><dt className="text-gray-500">Sampled</dt><dd className="text-right font-medium">{c.sampled}</dd></>}
                </dl>
                <div className="mt-auto flex gap-2 pt-3">
                  <Link to={`/p/${projectId}/pillar/${c.pillar}`} className="btn btn-sm">Open</Link>
                  {perms.manage && <button className="btn btn-sm" onClick={() => toggleLock(c.pillar, c.locked)}>{c.locked ? 'Unlock' : 'Lock'}</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="card mt-4">
            <div className="border-b px-4 py-2 font-semibold">General project evidence</div>
            <EvidencePanel projectId={projectId} orgId={p.data?.org_id} pillar={null} role={role ?? null} locked={false} />
          </div>
        </>
      )}
    </div>
  );
}
