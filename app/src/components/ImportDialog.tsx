import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap, callFunction, downloadBlob } from '../lib/supabase';
import { Modal, ErrorBox } from './ui';

interface ParseResult { headers: string[]; sample: unknown[][]; total_rows: number; suggested_map: Record<string, string | null>; columns: { id: string; label: string }[] }
interface ValidateResult { total_rows: number; valid_rows: number; error_rows: { row: number; errors: { column: string; message: string }[] }[]; new_masters: Record<string, number> }
interface CommitResult { committed: number; skipped: number; db_errors: { row: number; error: string }[]; created_masters: number }

export async function downloadTemplate(projectId: string, pillar: string, label: string) {
  downloadBlob(await callFunction<Blob>('dc-export', { project_id: projectId, pillars: [pillar], template: true }, true), `DC import template – ${label}.xlsx`);
}

export function ImportDialog({ projectId, pillar, pillarLabel, onClose }: { projectId: string; pillar: string; pillarLabel: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'file' | 'map' | 'check' | 'done'>('file');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [map, setMap] = useState<Record<string, string | null>>({});
  const [check, setCheck] = useState<ValidateResult | null>(null);
  const [mode, setMode] = useState<'valid_only' | 'all_or_nothing'>('valid_only');
  const [result, setResult] = useState<CommitResult | null>(null);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const upload = (file: File) => run(async () => {
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Choose a .csv or .xlsx file (save older .xls files as .xlsx first).');
    if (file.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.');
    const path = `project/${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-() ]+/g, '_')}`;
    const up = await supabase.storage.from('dc-imports').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) throw new Error(up.error.message);
    const job = unwrap(await supabase.from('dc_import_jobs').insert({ project_id: projectId, pillar, file_path: path, file_name: file.name }).select('id').single()) as { id: string };
    setJobId(job.id);
    const p = await callFunction<ParseResult>('dc-import', { action: 'parse', job_id: job.id });
    setParsed(p); setMap(p.suggested_map); setStep('map');
  });
  const validate = () => run(async () => {
    const v = await callFunction<ValidateResult>('dc-import', { action: 'validate', job_id: jobId, column_map: map });
    setCheck(v); setStep('check');
  });
  const commit = () => run(async () => {
    const r = await callFunction<CommitResult>('dc-import', { action: 'commit', job_id: jobId, column_map: map, mode });
    setResult(r); setStep('done');
    qc.invalidateQueries({ queryKey: ['rows', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard', projectId] }); qc.invalidateQueries({ queryKey: ['masters'] });
  });

  const used = new Set(Object.values(map).filter(Boolean));
  const unmappedRequired = parsed ? parsed.columns.filter((c) => !used.has(c.id) && /^(category|name|criteria|esd_category|yes_category|contribution_type|supplier_id\.name|person_id\.surname|person_id\.first_name|annual_spend_excl_vat|bee_level|occupational_level)$/.test(c.id)) : [];

  return (
    <Modal wide title={`Import – ${pillarLabel}`} onClose={onClose} footer={<>
      <button className="btn mr-auto" onClick={() => run(() => downloadTemplate(projectId, pillar, pillarLabel))}>Download template</button>
      {step === 'map' && <button className="btn-primary" disabled={busy} onClick={validate}>{busy ? 'Checking…' : 'Check rows'}</button>}
      {step === 'check' && <>
        <button className="btn" onClick={() => setStep('map')}>Back to mapping</button>
        <button className="btn-primary" disabled={busy || !check?.valid_rows || (mode === 'all_or_nothing' && check.valid_rows !== check.total_rows)} onClick={commit}>
          {busy ? 'Importing…' : mode === 'valid_only' ? `Import ${check?.valid_rows ?? 0} valid rows` : 'Import all rows'}</button>
      </>}
      {step === 'done' && <button className="btn-primary" onClick={onClose}>Close</button>}
    </>}>
      <div className="space-y-3 text-sm">
        <ErrorBox error={err} />
        {step === 'file' && (
          <div className="space-y-3">
            <p>Upload a <b>CSV</b> or <b>XLSX</b> file. Column headers are matched to fields automatically (including the old portal’s labels) and you can adjust the mapping before anything is saved.</p>
            <input type="file" accept=".csv,.xlsx" disabled={busy} aria-label="Choose file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {busy && <p className="text-gray-500">Uploading and reading the file…</p>}
          </div>
        )}
        {step === 'map' && parsed && (
          <>
            <p>{parsed.total_rows} rows found. Match each column in your file to a field (or ignore it).</p>
            {unmappedRequired.length > 0 && <div className="rounded bg-amber-50 p-2 text-amber-800">Not mapped yet: {unmappedRequired.map((c) => c.label).join(', ')}</div>}
            <div className="max-h-[50vh] overflow-y-auto rounded border">
              <table className="w-full">
                <thead><tr><th className="th">Column in your file</th><th className="th">Sample values</th><th className="th w-80">Maps to</th></tr></thead>
                <tbody>
                  {parsed.headers.map((h, i) => (
                    <tr key={h + i}>
                      <td className="td font-medium">{h || <i>(blank)</i>}</td>
                      <td className="td max-w-xs truncate text-xs text-gray-500">{parsed.sample.slice(0, 3).map((r) => r[i]).filter((x) => x !== null && x !== '').join(' · ')}</td>
                      <td className="td"><select className="input" value={map[h] ?? ''} onChange={(e) => setMap({ ...map, [h]: e.target.value || null })}>
                        <option value="">— ignore —</option>
                        {parsed.columns.map((c) => <option key={c.id} value={c.id} disabled={used.has(c.id) && map[h] !== c.id}>{c.label}</option>)}
                      </select></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {step === 'check' && check && (
          <>
            <div className="flex gap-4">
              <div className="rounded bg-green-50 px-3 py-2"><b className="text-lg">{check.valid_rows}</b> valid</div>
              <div className={`rounded px-3 py-2 ${check.error_rows.length ? 'bg-red-50' : 'bg-gray-50'}`}><b className="text-lg">{check.total_rows - check.valid_rows}</b> with errors</div>
              {Object.entries(check.new_masters).map(([k, n]) => <div key={k} className="rounded bg-blue-50 px-3 py-2"><b className="text-lg">{n}</b> new {k}</div>)}
            </div>
            {check.error_rows.length > 0 && (
              <div className="max-h-[40vh] overflow-y-auto rounded border">
                <table className="w-full"><thead><tr><th className="th w-16">Row</th><th className="th">Problems</th></tr></thead>
                  <tbody>{check.error_rows.slice(0, 300).map((r) => (
                    <tr key={r.row}><td className="td">{r.row}</td><td className="td text-red-800">{r.errors.map((e) => e.message).join(' · ')}</td></tr>
                  ))}</tbody></table>
              </div>
            )}
            <fieldset className="space-y-1">
              <legend className="label">How should rows with errors be handled?</legend>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === 'valid_only'} onChange={() => setMode('valid_only')} /> Import the valid rows only and skip the rest</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === 'all_or_nothing'} onChange={() => setMode('all_or_nothing')} /> All or nothing (import only if every row is valid)</label>
            </fieldset>
          </>
        )}
        {step === 'done' && result && (
          <div className="space-y-2">
            <div className="rounded bg-green-50 p-3"><b>{result.committed}</b> rows imported{result.created_masters ? `, ${result.created_masters} new people/suppliers/beneficiaries created` : ''}. {result.skipped ? `${result.skipped} rows skipped.` : ''}</div>
            {result.db_errors.length > 0 && <ul className="list-disc pl-5 text-red-800">{result.db_errors.slice(0, 50).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}
          </div>
        )}
      </div>
    </Modal>
  );
}
