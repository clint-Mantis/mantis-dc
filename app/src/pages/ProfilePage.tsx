import { useState } from 'react';
import { useApp, roleLabel } from '../lib/context';
import { supabase } from '../lib/supabase';
import { useToast, ErrorBox } from '../components/ui';

export function ProfilePage() {
  const { me, refreshMe } = useApp();
  const toast = useToast();
  const [name, setName] = useState(me?.profile?.full_name ?? '');
  const [phone, setPhone] = useState(me?.profile?.phone ?? '');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!me) return null;
  const save = async () => {
    setErr(null);
    const r = await supabase.from('dc_profiles').upsert({ user_id: me.user_id, full_name: name || null, phone: phone || null, updated_at: new Date().toISOString() });
    if (r.error) setErr(r.error.message); else { toast('Profile saved'); refreshMe(); }
  };
  const changePw = async () => {
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    const r = await supabase.auth.updateUser({ password: pw });
    if (r.error) setErr(r.error.message); else { setPw(''); toast('Password changed'); }
  };
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">My profile</h1>
      <div className="card space-y-3 p-5">
        <div className="text-sm text-gray-600">{me.email}{me.is_admin && <span className="badge ml-2 bg-ink text-white">Mantis admin</span>}</div>
        <label className="block"><span className="label">Full name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block"><span className="label">Phone</span><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <button className="btn-primary" onClick={save}>Save</button>
      </div>
      <div className="card space-y-3 p-5">
        <label className="block"><span className="label">New password</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <button className="btn" onClick={changePw}>Change password</button>
      </div>
      <ErrorBox error={err} />
      <div className="card p-5 text-sm">
        <div className="mb-2 font-semibold">My organisations</div>
        <ul className="space-y-1">{me.orgs.map((o) => <li key={o.id}>{o.name} – {roleLabel[o.role?.replace('project_', '') ?? ''] ?? o.role}{o.role?.startsWith('project_') ? ' (project only)' : ''}</li>)}</ul>
        {me.orgs.length === 0 && <p className="text-gray-500">None yet.</p>}
      </div>
    </div>
  );
}
