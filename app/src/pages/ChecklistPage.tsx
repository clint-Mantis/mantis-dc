import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { useMeta, can } from '../lib/context';
import { useDashboard, useProject } from '../lib/project';
import { ProjectHeader } from '../components/ProjectHeader';
import { EvidencePanel } from '../components/EvidencePanel';
import { Spinner, StatusBadge, useToast, ErrorBox } from '../components/ui';

interface Item { id: string; pillar: string | null; title: string; description: string | null; required: boolean; status: string; sort: number; note: string | null }

export function ChecklistPage() {
  const { projectId } = useParams();
  const meta = useMeta();
  const p = useProject(projectId);
  const d = useDashboard(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const role = d.data?.role ?? null;
  const perms = can(role);
  const [open, setOpen] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({ pillar: '', title: '', required: true });
  const q = useQuery({
    queryKey: ['checklist', projectId],
    enabled: !!projectId,
    queryFn: async () => unwrap(await supabase.from('dc_evidence_checklist_items').select('*').eq('project_id', projectId!).order('sort')) as Item[],
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['checklist', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard', projectId] }); };
  const setStatus = async (it: Item, status: string) => {
    const note = status === 'rejected' ? window.prompt('Reason for rejecting?', it.note ?? '') : it.note;
    if (status === 'rejected' && note === null) return;
    const r = await supabase.from('dc_evidence_checklist_items').update({ status, note }).eq('id', it.id);
    if (r.error) toast(r.error.message, 'error'); else refresh();
  };
  const add = async () => {
    const r = await supabase.from('dc_evidence_checklist_items').insert({ project_id: projectId, pillar: newItem.pillar || null, title: newItem.title, required: newItem.required, sort: 1000 });
    if (r.error) toast(r.error.message, 'error'); else { setNewItem({ pillar: '', title: '', required: true }); refresh(); }
  };
  if (!projectId) return null;
  const pillars = [...(meta.data?.pillars ?? []).map((x) => ({ code: x.code as string | null, label: x.label })), { code: null, label: 'General' }];
  const total = q.data?.length ?? 0;
  const accepted = q.data?.filter((x) => x.status === 'accepted').length ?? 0;
  return (
    <div>
      <ProjectHeader projectId={projectId} />
      <ErrorBox error={q.error} />
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Evidence checklist</h2>
        <div className="h-2 w-64 rounded bg-gray-200"><div className="h-2 rounded bg-green-600" style={{ width: `${total ? (accepted / total) * 100 : 0}%` }} /></div>
        <span className="text-sm text-gray-600">{accepted} of {total} accepted</span>
      </div>
      {q.isLoading ? <Spinner /> : pillars.map((pl) => {
        const items = q.data!.filter((x) => x.pillar === pl.code);
        if (!items.length) return null;
        const locked = !!d.data?.pillars.find((x) => x.pillar === pl.code)?.locked;
        return (
          <div key={pl.code ?? 'general'} className="card mb-3">
            <div className="border-b px-4 py-2 font-semibold">{pl.label}</div>
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.id}>
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <button className="text-left font-medium hover:text-brand" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>{open === it.id ? '▾' : '▸'} {it.title}</button>
                    {it.required && <span className="badge bg-brand-light text-brand">Required</span>}
                    <StatusBadge s={it.status} />
                    {it.note && <span className="text-xs italic text-gray-600">“{it.note}”</span>}
                    <span className="ml-auto flex gap-1">
                      {perms.verify && it.status !== 'accepted' && <button className="btn btn-sm" onClick={() => setStatus(it, 'accepted')}>Accept</button>}
                      {perms.verify && it.status !== 'rejected' && <button className="btn btn-sm" onClick={() => setStatus(it, 'rejected')}>Reject</button>}
                    </span>
                  </div>
                  {open === it.id && (
                    <div className="border-t bg-gray-50">
                      {it.description && <p className="px-4 pt-2 text-sm text-gray-600">{it.description}</p>}
                      <EvidencePanel projectId={projectId} orgId={p.data?.org_id} pillar={it.pillar} checklistItemId={it.id} role={role} locked={locked} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {perms.manage && (
        <div className="card flex flex-wrap items-end gap-2 p-3">
          <label><span className="label">Pillar</span><select className="input" value={newItem.pillar} onChange={(e) => setNewItem({ ...newItem, pillar: e.target.value })}>
            <option value="">General</option>{meta.data?.pillars.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></label>
          <label className="flex-1"><span className="label">Add a checklist item</span><input className="input" value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} /></label>
          <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={newItem.required} onChange={(e) => setNewItem({ ...newItem, required: e.target.checked })} />Required</label>
          <button className="btn-primary" disabled={!newItem.title.trim()} onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}
