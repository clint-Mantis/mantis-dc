import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp, useMeta, roleLabel } from '../lib/context';
import { supabase, unwrap } from '../lib/supabase';
import { ErrorBox, useToast } from '../components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function periodFor(fyEnd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fyEnd)) return null;
  const end = new Date(fyEnd + 'T00:00:00Z');
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate() + 1));
  const f = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return { start: start.toISOString().slice(0, 10), end: fyEnd, label: `FY${end.getUTCFullYear()} (${f(start)}–${f(end)})` };
}
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

type Member = { user_id: string; email: string; role: string };

export function WizardPage() {
  const { org, setOrg, me } = useApp();
  const meta = useMeta();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // step 1
  const [orgId, setOrgId] = useState(org?.id ?? '');
  const [orgName, setOrgName] = useState(org?.name ?? '');
  const [orgQ, setOrgQ] = useState('');
  const [newOrg, setNewOrg] = useState({ name: '', reg: '', vat: '' });
  const [divisionId, setDivisionId] = useState('');
  const [divisionName, setDivisionName] = useState('');
  // step 2
  const now = new Date();
  const [fyMonth, setFyMonth] = useState(2);
  const [fyYear, setFyYear] = useState(now.getFullYear());
  const fyEnd = lastDayOfMonth(fyYear, fyMonth);
  const period = periodFor(fyEnd);
  const [title, setTitle] = useState('');
  // step 3
  const [productId, setProductId] = useState('');
  const [sector, setSector] = useState('DTI');
  const [size, setSize] = useState('GENERIC');
  // step 4
  const [prevId, setPrevId] = useState('');
  const [copy, setCopy] = useState<string[]>(['ownership', 'management_control', 'procurement']);
  // step 5
  const [members, setMembers] = useState<Member[]>([]);
  const [userQ, setUserQ] = useState('');
  const [deadline, setDeadline] = useState('');
  const [verDate, setVerDate] = useState('');
  const [description, setDescription] = useState('');

  const orgSearch = useQuery({
    queryKey: ['wizard-orgs', orgQ], enabled: orgQ.length >= 2,
    queryFn: async () => unwrap(await supabase.rpc('dc_search_orgs', { p_q: orgQ, p_limit: 15 })) as { id: string; name: string; reg_number: string | null }[],
  });
  const divisions = useQuery({
    queryKey: ['divisions', orgId], enabled: !!orgId,
    queryFn: async () => unwrap(await supabase.from('dc_org_divisions').select('id, name').eq('org_id', orgId).order('name')) as { id: string; name: string }[],
  });
  const prevProjects = useQuery({
    queryKey: ['prev-projects', orgId], enabled: !!orgId,
    queryFn: async () => unwrap(await supabase.from('dc_projects').select('id, title, fy_end').eq('org_id', orgId).order('fy_end', { ascending: false })) as { id: string; title: string; fy_end: string }[],
  });
  const users = useQuery({
    queryKey: ['users', userQ], enabled: userQ.length >= 2,
    queryFn: async () => unwrap(await supabase.rpc('dc_list_users', { p_q: userQ, p_limit: 10 })) as { id: string; email: string; full_name: string | null }[],
  });
  const product = productId || meta.data?.products[0]?.id || '';
  const canNext = useMemo(() => {
    if (step === 1) return !!orgId;
    if (step === 2) return !!period;
    if (step === 3) return !!product && !!sector && !!size;
    return true;
  }, [step, orgId, period, product, sector, size]);

  const createOrg = async () => {
    setErr(null);
    try {
      const id = unwrap(await supabase.rpc('dc_create_org', { p_name: newOrg.name, p_reg: newOrg.reg, p_vat: newOrg.vat })) as string;
      setOrgId(id); setOrgName(newOrg.name); setNewOrg({ name: '', reg: '', vat: '' });
      toast(`Organisation “${newOrg.name}” created in Mantis Hub`);
    } catch (e) { setErr((e as Error).message); }
  };

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const id = unwrap(await supabase.rpc('dc_create_project', {
        p: {
          org_id: orgId, division_id: divisionId || null, division_name: divisionId ? null : divisionName || null,
          product_id: product, sector_code: sector, size, fy_end: fyEnd, title: title || null,
          data_deadline: deadline || null, verification_date: verDate || null, description: description || null,
          previous_project_id: prevId || null, copy_pillars: prevId ? copy : [],
          members: members.map((m) => ({ user_id: m.user_id, role: m.role })),
        },
      })) as string;
      if (org?.id !== orgId) setOrg({ id: orgId, name: orgName });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast('Project created');
      nav(`/p/${id}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const steps = ['Organisation', 'Financial year', 'Product & sector', 'Copy forward', 'Team & dates', 'Create'];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New B-BBEE project</h1>
      <ol className="flex flex-wrap gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      <div className="card space-y-4 p-5">
        {step === 1 && (
          <>
            <div>
              <div className="label">Organisation</div>
              {orgId ? (
                <div className="flex items-center gap-3"><b>{orgName}</b><button className="btn btn-sm" onClick={() => { setOrgId(''); setOrgName(''); setDivisionId(''); }}>Change</button></div>
              ) : (
                <>
                  <input className="input" placeholder="Search Mantis Hub organisations by name or registration number…" value={orgQ} onChange={(e) => setOrgQ(e.target.value)} />
                  <ul className="mt-1 max-h-56 overflow-y-auto rounded border text-sm">
                    {(orgQ.length < 2 ? me?.orgs ?? [] : orgSearch.data ?? []).map((o) => (
                      <li key={o.id}><button className="w-full px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => { setOrgId(o.id); setOrgName(o.name); }}>{o.name}</button></li>
                    ))}
                  </ul>
                  {(me?.is_admin || me?.is_staff) && (
                    <details className="mt-3 rounded border p-3">
                      <summary className="cursor-pointer text-sm font-medium">Organisation not in Mantis Hub? Create it</summary>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <input className="input" placeholder="Name *" value={newOrg.name} onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })} />
                        <input className="input" placeholder="Registration no" value={newOrg.reg} onChange={(e) => setNewOrg({ ...newOrg, reg: e.target.value })} />
                        <input className="input" placeholder="VAT no" value={newOrg.vat} onChange={(e) => setNewOrg({ ...newOrg, vat: e.target.value })} />
                      </div>
                      <button className="btn mt-2" disabled={!newOrg.name.trim()} onClick={createOrg}>Create organisation</button>
                    </details>
                  )}
                </>
              )}
            </div>
            {orgId && (
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">Division / subsidiary (optional)</span>
                  <select className="input" value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
                    <option value="">— none / new —</option>
                    {divisions.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select></label>
                {!divisionId && <label><span className="label">…or create a division</span>
                  <input className="input" value={divisionName} onChange={(e) => setDivisionName(e.target.value)} placeholder="e.g. Head Office" /></label>}
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="label">Financial year-end month</span>
                <select className="input" value={fyMonth} onChange={(e) => setFyMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select></label>
              <label><span className="label">Financial year-end year</span>
                <input className="input" type="number" min={2015} max={2100} value={fyYear} onChange={(e) => setFyYear(Number(e.target.value))} /></label>
            </div>
            {period && <div className="rounded bg-gray-50 p-3 text-sm">Measurement period <b>{period.start}</b> to <b>{period.end}</b> · label <b>{period.label}</b></div>}
            <label className="block"><span className="label">Project title (optional – defaults to the label)</span>
              <input className="input" value={title} placeholder={period?.label} onChange={(e) => setTitle(e.target.value)} /></label>
          </>
        )}
        {step === 3 && (
          <div className="grid grid-cols-3 gap-3">
            <label><span className="label">Product</span>
              <select className="input" value={product} onChange={(e) => setProductId(e.target.value)}>
                {meta.data?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label><span className="label">Sector code</span>
              <select className="input" value={sector} onChange={(e) => setSector(e.target.value)}>
                {meta.data?.sectors.filter((s) => s.active).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select></label>
            <label><span className="label">Size</span>
              <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="EME">EME</option><option value="QSE">QSE</option><option value="GENERIC">Generic</option>
              </select></label>
          </div>
        )}
        {step === 4 && (
          <>
            <label className="block"><span className="label">Copy forward from a previous project (optional)</span>
              <select className="input" value={prevId} onChange={(e) => setPrevId(e.target.value)}>
                <option value="">— start empty —</option>
                {prevProjects.data?.map((p) => <option key={p.id} value={p.id}>{p.title} (FY end {p.fy_end})</option>)}
              </select></label>
            {prevId && (
              <fieldset className="space-y-1 text-sm">
                <legend className="label">Pillars to copy (rows are marked “confirm” until reviewed)</legend>
                {[['ownership', 'Ownership'], ['management_control', 'Management Control'], ['procurement', 'Suppliers']].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={copy.includes(k)} onChange={(e) => setCopy(e.target.checked ? [...copy, k] : copy.filter((x) => x !== k))} />{l}</label>
                ))}
                <p className="text-xs text-gray-500">People, suppliers and ESD/SED beneficiaries are shared by the organisation, so they are always available.</p>
              </fieldset>
            )}
          </>
        )}
        {step === 5 && (
          <>
            <div>
              <div className="label">Team (project-level access)</div>
              <input className="input" placeholder="Find a user by email or name…" value={userQ} onChange={(e) => setUserQ(e.target.value)} />
              {users.data && userQ.length >= 2 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded border text-sm">
                  {users.data.filter((u) => !members.some((m) => m.user_id === u.id)).map((u) => (
                    <li key={u.id}><button className="w-full px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => { setMembers([...members, { user_id: u.id, email: u.email, role: 'client_editor' }]); setUserQ(''); }}>{u.full_name ? `${u.full_name} – ` : ''}{u.email}</button></li>
                  ))}
                  {users.data.length === 0 && <li className="px-3 py-1.5 text-gray-500">No users found – invite them from Admin › Users first.</li>}
                </ul>
              )}
              <table className="mt-2 w-full">
                <tbody>{members.map((m, i) => (
                  <tr key={m.user_id}>
                    <td className="td">{m.email}</td>
                    <td className="td w-48"><select className="input" value={m.role} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                      {['consultant', 'client_editor', 'client_viewer', 'verifier'].map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                    </select></td>
                    <td className="td w-10"><button className="btn btn-sm" aria-label={`Remove ${m.email}`} onClick={() => setMembers(members.filter((_, j) => j !== i))}>×</button></td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-1 text-xs text-gray-500">Organisation members (consultants, client editors and viewers) get access automatically. Add verifiers here – they only see this project.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="label">Data deadline</span><input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
              <label><span className="label">Verification date</span><input className="input" type="date" value={verDate} onChange={(e) => setVerDate(e.target.value)} /></label>
            </div>
            <label className="block"><span className="label">Description</span><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          </>
        )}
        {step === 6 && (
          <dl className="grid grid-cols-[180px_1fr] gap-y-1 text-sm">
            <dt className="text-gray-500">Organisation</dt><dd>{orgName}</dd>
            <dt className="text-gray-500">Division</dt><dd>{divisions.data?.find((d) => d.id === divisionId)?.name ?? (divisionName || '–')}</dd>
            <dt className="text-gray-500">Title</dt><dd>{title || period?.label}</dd>
            <dt className="text-gray-500">Measurement period</dt><dd>{period?.start} – {period?.end}</dd>
            <dt className="text-gray-500">Sector / size</dt><dd>{meta.data?.sectors.find((s) => s.code === sector)?.name} / {size}</dd>
            <dt className="text-gray-500">Copy forward</dt><dd>{prevId ? `${prevProjects.data?.find((p) => p.id === prevId)?.title}: ${copy.join(', ')}` : 'No'}</dd>
            <dt className="text-gray-500">Team</dt><dd>{members.length ? members.map((m) => `${m.email} (${roleLabel[m.role]})`).join(', ') : 'Organisation members only'}</dd>
            <dt className="text-gray-500">Deadlines</dt><dd>Data {deadline || '–'} · Verification {verDate || '–'}</dd>
          </dl>
        )}
        <ErrorBox error={err} />
        <div className="flex justify-between border-t pt-3">
          <button className="btn" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</button>
          {step < 6 ? <button className="btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create project'}</button>}
        </div>
      </div>
    </div>
  );
}
