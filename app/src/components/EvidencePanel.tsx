import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { can, type ProjectRole } from '../lib/context';
import { Modal, StatusBadge, useToast, Spinner } from './ui';

export interface EvidenceFile {
  id: string; project_id: string; pillar: string | null; record_table: string | null; record_id: string | null; checklist_item_id: string | null;
  storage_path: string; file_name: string; mime_type: string | null; size_bytes: number | null; uploaded_by: string; uploaded_at: string;
  status: 'pending' | 'accepted' | 'rejected'; note: string | null;
}
const MAX = 25 * 1024 * 1024;
const ALLOWED = /\.(pdf|png|jpe?g|gif|webp|tiff?|xlsx|xls|csv|docx?|zip)$/i;
const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', zip: 'application/zip' };
const fmtSize = (b: number | null) => (b === null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

export async function signedUrl(path: string, download?: string) {
  const r = await supabase.storage.from('dc-evidence').createSignedUrl(path, 600, download ? { download } : undefined);
  if (r.error) throw new Error(r.error.message);
  return r.data.signedUrl;
}

export function EvidencePanel({ projectId, orgId, pillar, recordTable, recordId, checklistItemId, role, locked, compact }: {
  projectId: string; orgId: string | undefined; pillar: string | null; recordTable?: string; recordId?: string; checklistItemId?: string;
  role: ProjectRole | string | null; locked: boolean; compact?: boolean;
}) {
  const perms = can(role);
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; f: EvidenceFile } | null>(null);
  const key = ['evidence', projectId, pillar, recordTable, recordId, checklistItemId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      let qb = supabase.from('dc_evidence_files').select('*').eq('project_id', projectId).order('uploaded_at', { ascending: false });
      if (recordId) qb = qb.eq('record_table', recordTable!).eq('record_id', recordId);
      else if (checklistItemId) qb = qb.eq('checklist_item_id', checklistItemId);
      else if (pillar) qb = qb.eq('pillar', pillar).is('record_id', null);
      else qb = qb.is('pillar', null).is('record_id', null).is('checklist_item_id', null);
      return unwrap(await qb) as EvidenceFile[];
    },
  });
  const canUpload = perms.capture && (!locked || perms.manage);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['evidence', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard', projectId] }); qc.invalidateQueries({ queryKey: ['checklist', projectId] }); qc.invalidateQueries({ queryKey: ['rows', projectId] }); };

  const upload = async (files: FileList | File[]) => {
    if (!orgId) return;
    setBusy(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX) { toast(`${file.name} is larger than 25 MB`, 'error'); continue; }
      if (!ALLOWED.test(file.name)) { toast(`${file.name}: only PDF, images, Excel/CSV, Word and ZIP files are allowed`, 'error'); continue; }
      const ext = file.name.split('.').pop()!.toLowerCase();
      const safe = file.name.replace(/[^\w.\-() ]+/g, '_');
      const path = `org/${orgId}/project/${projectId}/${pillar ?? 'general'}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from('dc-evidence').upload(path, file, { contentType: file.type || MIME[ext], upsert: false });
      if (up.error) { toast(`${file.name}: ${up.error.message}`, 'error'); continue; }
      const ins = await supabase.from('dc_evidence_files').insert({
        project_id: projectId, pillar, record_table: recordTable ?? null, record_id: recordId ?? null, checklist_item_id: checklistItemId ?? null,
        storage_path: path, file_name: file.name, mime_type: file.type || MIME[ext], size_bytes: file.size,
      });
      if (ins.error) { await supabase.storage.from('dc-evidence').remove([path]); toast(`${file.name}: ${ins.error.message}`, 'error'); continue; }
      ok++;
    }
    setBusy(false);
    if (ok) { toast(`${ok} file${ok > 1 ? 's' : ''} uploaded`); refresh(); }
  };
  const review = async (f: EvidenceFile, status: 'accepted' | 'rejected' | 'pending') => {
    const note = status === 'rejected' ? window.prompt('Reason for rejecting this file?', f.note ?? '') : f.note;
    if (status === 'rejected' && note === null) return;
    try { unwrap(await supabase.from('dc_evidence_files').update({ status, note }).eq('id', f.id)); refresh(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const remove = async (f: EvidenceFile) => {
    if (!window.confirm(`Delete ${f.file_name}?`)) return;
    try {
      unwrap(await supabase.from('dc_evidence_files').delete().eq('id', f.id).select());
      await supabase.storage.from('dc-evidence').remove([f.storage_path]);
      refresh();
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const open = async (f: EvidenceFile) => {
    try {
      if (f.mime_type === 'application/pdf' || f.mime_type?.startsWith('image/')) setPreview({ url: await signedUrl(f.storage_path), f });
      else window.open(await signedUrl(f.storage_path, f.file_name), '_blank');
    } catch (e) { toast(perms.full ? (e as Error).message : 'Viewers can see the evidence list but not open files.', 'error'); }
  };

  return (
    <div className={compact ? '' : 'p-3'}>
      {canUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={`mb-2 flex items-center justify-center gap-2 rounded border-2 border-dashed px-3 py-3 text-sm ${drag ? 'border-brand bg-brand-light' : 'border-gray-300 text-gray-500'}`}>
          {busy ? 'Uploading…' : <>Drag files here or <button className="text-brand underline" onClick={() => input.current?.click()}>browse</button> · max 25 MB · PDF, images, Excel/CSV, Word, ZIP</>}
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
      )}
      {q.isLoading ? <Spinner /> : (
        <ul className="divide-y text-sm">
          {q.data?.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <button className="max-w-[260px] truncate text-left text-brand hover:underline" onClick={() => open(f)} title={f.file_name}>{f.file_name}</button>
              <span className="text-xs text-gray-500">{fmtSize(f.size_bytes)} · {f.uploaded_at.slice(0, 10)}</span>
              <StatusBadge s={f.status} />
              {f.note && <span className="text-xs italic text-gray-600">“{f.note}”</span>}
              <span className="ml-auto flex gap-1">
                {perms.verify && f.status !== 'accepted' && <button className="btn btn-sm" onClick={() => review(f, 'accepted')}>Accept</button>}
                {perms.verify && f.status !== 'rejected' && <button className="btn btn-sm" onClick={() => review(f, 'rejected')}>Reject</button>}
                {perms.capture && f.status !== 'accepted' && <button className="btn btn-sm" aria-label={`Delete ${f.file_name}`} onClick={() => remove(f)}>Delete</button>}
              </span>
            </li>
          ))}
          {q.data?.length === 0 && <li className="py-2 text-gray-500">No evidence uploaded yet.</li>}
        </ul>
      )}
      {preview && (
        <Modal wide title={preview.f.file_name} onClose={() => setPreview(null)} footer={<a className="btn" href={preview.url} target="_blank" rel="noreferrer">Open in new tab</a>}>
          {preview.f.mime_type?.startsWith('image/')
            ? <img src={preview.url} alt={preview.f.file_name} className="mx-auto max-h-[70vh]" />
            : <iframe title={preview.f.file_name} src={preview.url} className="h-[70vh] w-full" />}
        </Modal>
      )}
    </div>
  );
}
