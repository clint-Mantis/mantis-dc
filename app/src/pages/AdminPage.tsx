import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp, useMeta, roleLabel } from '../lib/context';
import { supabase, unwrap, callFunction } from '../lib/supabase';
import { Tabs, Spinner, ErrorBox, useToast } from '../components/ui';

type Tab = 'users' | 'divisions' | 'sectors' | 'lookups' | 'fields' | 'evidence';

export function AdminPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<Tab>('users');
  if (!me?.is_admin) return <div className="card p-6 text-sm">The admin area is for Mantis admins only.</div>;
  return (
    <div className="card">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'users', label: 'Users & memberships' }, { id: 'divisions', label: 'Divisions' }, { id: 'sectors', label: 'Sector codes & products' },
        { id: 'lookups', label: 'Lookups' }, { id: 'fields', label: 'Field metadata' }, { id: 'evidence', label: 'Evidence templates' },
      ]} />
      <div className="p-4">
        {tab === 'users' && <UsersAdmin />}
        {tab === 'divisions' && <DivisionsAdmin />}
        {tab === 'sectors' && <SectorsAdmin />}
        {tab === 'lookups' && <LookupsAdmin />}
        {tab === 'fields' && <FieldsAdmin />}
        {tab === 'evidence' && <EvidenceTemplatesAdmin />}
      </div>
    </div>
  );
}

function OrgPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (o: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const s = useQuery({ queryKey: ['admin-org', q], enabled: q.length >= 2, queryFn: async () => unwrap(await supabase.rpc('dc_search_orgs', { p_q: q, p_limit: 10 })) as { id: string; name: string }[] });
  if (value) return <div className="flex items-center gap-2"><b>{value.name}</b><button className="btn btn-sm" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div className="relative">
      <input className="input" placeholder="Search organisation…" value={q} onChange={(e) => setQ(e.target.value)} />
      {s.data && q.length >= 2 && <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border bg-white text-sm shadow">{s.data.map((o) => <li key={o.id}><button className="w-full px-3 py-1 text-left hover:bg-gray-100" onClick={() => { onChange(o); setQ(''); }}>{o.name}</button></li>)}</ul>}
    </div>
  );
}

function UsersAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null);
  const [userQ, setUserQ] = useState('');
  const [role, setRole] = useState('client_editor');
  const [invite, setInvite] = useState({ email: '', full_name: '' });
  const [err, setErr] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['admin-users', userQ], queryFn: async () => unwrap(await supabase.rpc('dc_list_users', { p_q: userQ || null, p_limit: 30 })) as { id: string; email: string; full_name: string | null }[] });
  const members = useQuery({
    queryKey: ['admin-members', org?.id],
    enabled: !!org,
    queryFn: async () => {
      const m = unwrap(await supabase.from('dc_memberships').select('*').eq('org_id', org!.id)) as { user_id: string; org_id: string; role: string }[];
      const names = m.length ? unwrap(await supabase.rpc('dc_user_names', { p_ids: m.map((x) => x.user_id) })) as { id: string; name: string }[] : [];
      return m.map((x) => ({ ...x, name: names.find((n) => n.id === x.user_id)?.name ?? x.user_id }));
    },
  });
  const admins = useQuery({ queryKey: ['admin-admins'], queryFn: async () => {
    const a = unwrap(await supabase.from('dc_admins').select('user_id')) as { user_id: string }[];
    return a.length ? unwrap(await supabase.rpc('dc_user_names', { p_ids: a.map((x) => x.user_id) })) as { id: string; name: string }[] : [];
  } });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-members'] }); qc.invalidateQueries({ queryKey: ['admin-admins'] }); qc.invalidateQueries({ queryKey: ['admin-users'] }); };
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => { setErr(null); const r = await fn(); if (r.error) setErr(r.error.message); else { toast(ok); refresh(); } };
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="font-semibold">Organisation memberships</h3>
        <OrgPicker value={org} onChange={setOrg} />
        {org && (members.isLoading ? <Spinner /> : (
          <table className="w-full"><thead><tr><th className="th">User</th><th className="th">Role</th><th className="th" /></tr></thead>
            <tbody>{members.data?.map((m) => (
              <tr key={m.user_id}><td className="td">{m.name}</td>
                <td className="td"><select className="input" value={m.role} onChange={(e) => act(() => supabase.from('dc_memberships').update({ role: e.target.value }).eq('user_id', m.user_id).eq('org_id', m.org_id), 'Role updated')}>
                  {['consultant', 'client_editor', 'client_viewer'].map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select></td>
                <td className="td"><button className="btn btn-sm" onClick={() => act(() => supabase.from('dc_memberships').delete().eq('user_id', m.user_id).eq('org_id', m.org_id), 'Membership removed')}>Remove</button></td></tr>
            ))}
              {members.data?.length === 0 && <tr><td className="td text-gray-500" colSpan={3}>No members yet.</td></tr>}
            </tbody></table>
        ))}
        <h3 className="pt-3 font-semibold">Users</h3>
        <input className="input" placeholder="Search users by email or name…" value={userQ} onChange={(e) => setUserQ(e.target.value)} />
        {!org && <div className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">To add a user to an organisation, first choose the organisation in “Organisation memberships” above – then “Add to org” switches on.</div>}
        {org && <div className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">“Add to org” adds the user to <b>{org.name}</b> (client roles also get a Mantis Hub contact).</div>}
        <div className="flex items-center gap-2 text-sm">Role for “Add to org”:
          <select className="input w-44" value={role} onChange={(e) => setRole(e.target.value)}>{['consultant', 'client_editor', 'client_viewer'].map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select></div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded border text-sm">
          {users.data?.map((u) => (
            <li key={u.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="truncate">{u.full_name ? `${u.full_name} – ` : ''}{u.email}</span>
              {admins.data?.some((a) => a.id === u.id) && <span className="badge bg-ink text-white">Admin</span>}
              <span className="ml-auto flex gap-1">
                <button className="btn btn-sm" disabled={!org} title={org ? '' : 'Choose an organisation first'} onClick={() => act(() => supabase.from('dc_memberships').upsert({ user_id: u.id, org_id: org!.id, role }), `Added to ${org!.name}`)}>Add to org</button>
                {admins.data?.some((a) => a.id === u.id)
                  ? <button className="btn btn-sm" onClick={() => act(() => supabase.from('dc_admins').delete().eq('user_id', u.id), 'Admin removed')}>Remove admin</button>
                  : <button className="btn btn-sm" onClick={() => act(() => supabase.from('dc_admins').insert({ user_id: u.id }), 'Admin added')}>Make admin</button>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">Invite a new user</h3>
        <p className="text-sm text-gray-600">Sends a Supabase invitation email. Existing Mantis Hub users don’t need inviting – find them on the left.</p>
        <input className="input" placeholder="Email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
        <input className="input" placeholder="Full name" value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} />
        <p className="text-xs text-gray-500">{org ? `They will be added to ${org.name} as ${roleLabel[role]}.` : 'Choose an organisation on the left to add them to it as well.'}</p>
        <button className="btn-primary" disabled={!invite.email} onClick={async () => {
          setErr(null);
          try {
            await callFunction('dc-invite', { ...invite, org_id: org?.id, role: org ? role : undefined, redirect_to: window.location.origin + window.location.pathname });
            toast('Invitation sent'); setInvite({ email: '', full_name: '' }); refresh();
          } catch (e) { setErr((e as Error).message); }
        }}>Send invitation</button>
        <ErrorBox error={err} />
        <h3 className="pt-3 font-semibold">DC admins</h3>
        <ul className="text-sm">{admins.data?.map((a) => <li key={a.id}>{a.name}</li>)}</ul>
        <p className="text-xs text-gray-500">Mantis Hub super admins are DC admins automatically.</p>
      </div>
    </div>
  );
}

function DivisionsAdmin() {
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['divisions', org?.id], enabled: !!org, queryFn: async () => unwrap(await supabase.from('dc_org_divisions').select('*').eq('org_id', org!.id).order('name')) as { id: string; name: string }[] });
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { const r = await fn(); if (r.error) toast(r.error.message, 'error'); else qc.invalidateQueries({ queryKey: ['divisions', org?.id] }); };
  return (
    <div className="max-w-xl space-y-3">
      <OrgPicker value={org} onChange={setOrg} />
      {org && <>
        <ul className="divide-y rounded border text-sm">{q.data?.map((d) => (
          <li key={d.id} className="flex items-center gap-2 px-3 py-1.5"><input className="input" defaultValue={d.name} onBlur={(e) => e.target.value !== d.name && act(() => supabase.from('dc_org_divisions').update({ name: e.target.value }).eq('id', d.id))} />
            <button className="btn btn-sm" onClick={() => act(() => supabase.from('dc_org_divisions').delete().eq('id', d.id))}>Delete</button></li>))}</ul>
        <div className="flex gap-2"><input className="input" placeholder="New division" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" disabled={!name} onClick={() => { act(() => supabase.from('dc_org_divisions').insert({ org_id: org.id, name })); setName(''); }}>Add</button></div>
      </>}
    </div>
  );
}

function SectorsAdmin() {
  const meta = useMeta(); const qc = useQueryClient(); const toast = useToast();
  const [s, setS] = useState({ code: '', name: '' }); const [pr, setPr] = useState({ code: '', name: '' });
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { const r = await fn(); if (r.error) toast(r.error.message, 'error'); else qc.invalidateQueries({ queryKey: ['meta'] }); };
  if (!meta.data) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div><h3 className="mb-2 font-semibold">Sector codes</h3>
        <table className="w-full"><tbody>{meta.data.sectors.map((x) => (
          <tr key={x.code}><td className="td font-mono text-xs">{x.code}</td><td className="td"><input className="input" defaultValue={x.name} onBlur={(e) => e.target.value !== x.name && act(() => supabase.from('dc_sector_codes').update({ name: e.target.value }).eq('code', x.code))} /></td>
            <td className="td"><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={x.active} onChange={(e) => act(() => supabase.from('dc_sector_codes').update({ active: e.target.checked }).eq('code', x.code))} />Active</label></td></tr>))}</tbody></table>
        <div className="mt-2 flex gap-2"><input className="input w-40" placeholder="CODE" value={s.code} onChange={(e) => setS({ ...s, code: e.target.value.toUpperCase() })} /><input className="input" placeholder="Name" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          <button className="btn-primary" disabled={!s.code || !s.name} onClick={() => { act(() => supabase.from('dc_sector_codes').insert(s)); setS({ code: '', name: '' }); }}>Add</button></div>
      </div>
      <div><h3 className="mb-2 font-semibold">Products</h3>
        <table className="w-full"><tbody>{meta.data.products.map((x) => (
          <tr key={x.id}><td className="td font-mono text-xs">{x.code}</td><td className="td"><input className="input" defaultValue={x.name} onBlur={(e) => e.target.value !== x.name && act(() => supabase.from('dc_products').update({ name: e.target.value }).eq('id', x.id))} /></td></tr>))}</tbody></table>
        <div className="mt-2 flex gap-2"><input className="input w-40" placeholder="CODE" value={pr.code} onChange={(e) => setPr({ ...pr, code: e.target.value.toUpperCase() })} /><input className="input" placeholder="Name" value={pr.name} onChange={(e) => setPr({ ...pr, name: e.target.value })} />
          <button className="btn-primary" disabled={!pr.code || !pr.name} onClick={() => { act(() => supabase.from('dc_products').insert(pr)); setPr({ code: '', name: '' }); }}>Add</button></div>
      </div>
    </div>
  );
}

function LookupsAdmin() {
  const meta = useMeta(); const qc = useQueryClient(); const toast = useToast();
  const [type, setType] = useState('race'); const [n, setN] = useState({ code: '', label: '' });
  if (!meta.data) return <Spinner />;
  const types = [...new Set(meta.data.lookups.map((l) => l.type))].sort();
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { const r = await fn(); if (r.error) toast(r.error.message, 'error'); else qc.invalidateQueries({ queryKey: ['meta'] }); };
  return (
    <div className="max-w-3xl space-y-3">
      <select className="input w-64" value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select>
      <table className="w-full"><thead><tr><th className="th">Code</th><th className="th">Label</th><th className="th">Sort</th><th className="th">Active</th><th className="th">Meta</th></tr></thead>
        <tbody>{meta.data.lookups.filter((l) => l.type === type).map((l) => (
          <tr key={l.id}><td className="td font-mono text-xs">{l.code}</td>
            <td className="td"><input className="input" defaultValue={l.label} onBlur={(e) => e.target.value !== l.label && act(() => supabase.from('dc_lookups').update({ label: e.target.value }).eq('id', l.id))} /></td>
            <td className="td w-20"><input className="input" type="number" defaultValue={l.sort} onBlur={(e) => Number(e.target.value) !== l.sort && act(() => supabase.from('dc_lookups').update({ sort: Number(e.target.value) }).eq('id', l.id))} /></td>
            <td className="td"><input type="checkbox" checked={l.active !== false} onChange={(e) => act(() => supabase.from('dc_lookups').update({ active: e.target.checked }).eq('id', l.id))} aria-label="Active" /></td>
            <td className="td"><input className="input font-mono text-xs" defaultValue={JSON.stringify(l.meta ?? {})} onBlur={(e) => { try { const m = JSON.parse(e.target.value); act(() => supabase.from('dc_lookups').update({ meta: m }).eq('id', l.id)); } catch { toast('Meta must be valid JSON', 'error'); } }} /></td></tr>))}</tbody></table>
      <p className="text-xs text-gray-500">Codes are used by the visibility rules and imports, so they cannot be changed – deactivate an option instead. ESD/SED benefit factors go in Meta, e.g. {'{"benefit_factor": 1}'}.</p>
      <div className="flex gap-2"><input className="input w-40" placeholder="Code" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} /><input className="input" placeholder="Label" value={n.label} onChange={(e) => setN({ ...n, label: e.target.value })} />
        <button className="btn-primary" disabled={!n.code || !n.label} onClick={() => { act(() => supabase.from('dc_lookups').insert({ type, ...n, sort: 999 })); setN({ code: '', label: '' }); }}>Add option</button></div>
    </div>
  );
}

function FieldsAdmin() {
  const meta = useMeta();
  const [pillar, setPillar] = useState('ownership');
  if (!meta.data) return <Spinner />;
  return (
    <div className="space-y-3">
      <select className="input w-72" value={pillar} onChange={(e) => setPillar(e.target.value)}>{meta.data.pillars.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select>
      <p className="text-xs text-gray-500">Read-only in Phase 1. Field definitions are generated from <code>supabase/spec/fields.mjs</code>; change them there and run the generator so the database, templates and tests stay in step.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Key', 'Label', 'Type', 'Options', 'Required', 'Group', 'Legacy labels'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{meta.data.defs.filter((d) => d.pillar === pillar).map((d) => (
          <tr key={d.key}><td className="td font-mono text-xs">{d.key}</td><td className="td">{d.label}</td><td className="td">{d.data_type}</td>
            <td className="td text-xs">{d.lookup_type ?? d.fk_target ?? d.enum_values?.join(', ') ?? ''}{d.min_value != null ? ` min ${d.min_value}` : ''}{d.max_value != null ? ` max ${d.max_value}` : ''}</td>
            <td className="td">{d.required ? 'Yes' : ''}</td><td className="td">{d.group_name}</td><td className="td text-xs">{d.legacy_labels?.join(', ')}</td></tr>))}</tbody></table></div>
      <h3 className="pt-2 font-semibold">Visibility rules</h3>
      <table className="w-full text-sm"><thead><tr>{['Field', 'When', 'Sector', 'Visible', 'Required', 'Note'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{meta.data.rules.filter((r) => r.pillar === pillar).map((r, i) => (
          <tr key={i}><td className="td font-mono text-xs">{r.key}</td><td className="td text-xs">{r.criteria_value ? `${r.criteria_key} = ${r.criteria_value}` : `default (${r.criteria_key ?? 'any'})`}</td>
            <td className="td">{r.sector_code ?? 'any'}</td><td className="td">{r.visible ? 'show' : 'hide'}</td><td className="td">{r.required === null ? '' : r.required ? 'required' : 'optional'}</td><td className="td text-xs text-amber-700">{(r as { note?: string }).note ?? ''}</td></tr>))}</tbody></table>
    </div>
  );
}

function EvidenceTemplatesAdmin() {
  const meta = useMeta(); const qc = useQueryClient(); const toast = useToast();
  const [n, setN] = useState({ sector_code: '', pillar: '', title: '', description: '', required: true });
  const q = useQuery({ queryKey: ['ev-templates'], queryFn: async () => unwrap(await supabase.from('dc_evidence_templates').select('*').order('sort')) as { id: string; sector_code: string | null; pillar: string | null; title: string; description: string | null; required: boolean }[] });
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { const r = await fn(); if (r.error) toast(r.error.message, 'error'); else qc.invalidateQueries({ queryKey: ['ev-templates'] }); };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Checklist items are copied from these templates when a project is created (templates with no sector apply to every sector).</p>
      <table className="w-full text-sm"><thead><tr>{['Sector', 'Pillar', 'Title', 'Description', 'Required', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{q.data?.map((t) => (
          <tr key={t.id}><td className="td">{t.sector_code ?? 'all'}</td><td className="td">{meta.data?.pillars.find((p) => p.code === t.pillar)?.label ?? 'General'}</td>
            <td className="td"><input className="input" defaultValue={t.title} onBlur={(e) => e.target.value !== t.title && act(() => supabase.from('dc_evidence_templates').update({ title: e.target.value }).eq('id', t.id))} /></td>
            <td className="td"><input className="input" defaultValue={t.description ?? ''} onBlur={(e) => act(() => supabase.from('dc_evidence_templates').update({ description: e.target.value }).eq('id', t.id))} /></td>
            <td className="td"><input type="checkbox" checked={t.required} onChange={(e) => act(() => supabase.from('dc_evidence_templates').update({ required: e.target.checked }).eq('id', t.id))} aria-label="Required" /></td>
            <td className="td"><button className="btn btn-sm" onClick={() => act(() => supabase.from('dc_evidence_templates').delete().eq('id', t.id))}>Delete</button></td></tr>))}</tbody></table>
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-40" value={n.sector_code} onChange={(e) => setN({ ...n, sector_code: e.target.value })}><option value="">All sectors</option>{meta.data?.sectors.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
        <select className="input w-56" value={n.pillar} onChange={(e) => setN({ ...n, pillar: e.target.value })}><option value="">General</option>{meta.data?.pillars.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</select>
        <input className="input w-64" placeholder="Title" value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} />
        <input className="input flex-1" placeholder="Description" value={n.description} onChange={(e) => setN({ ...n, description: e.target.value })} />
        <button className="btn-primary" disabled={!n.title} onClick={() => { act(() => supabase.from('dc_evidence_templates').insert({ ...n, sector_code: n.sector_code || null, pillar: n.pillar || null, sort: 999 })); setN({ ...n, title: '', description: '' }); }}>Add</button>
      </div>
    </div>
  );
}
