import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { ErrorBox } from '../components/ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magic' | 'reset'>('password');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const redirectTo = window.location.origin + window.location.pathname;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
        if (error) throw error;
        setMsg('Check your email for a sign-in link.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setMsg('If the address is registered, a password reset link is on its way.');
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-4">
      <div className="mb-6 flex items-center gap-2 text-xl font-semibold"><span className="rounded bg-brand px-2 py-1 text-white">DC</span>Mantis Data Capture</div>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 p-6">
        <h1 className="text-lg font-semibold">{mode === 'reset' ? 'Reset password' : 'Sign in'}</h1>
        <label className="block"><span className="label">Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === 'password' && (
          <label className="block"><span className="label">Password</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        )}
        <ErrorBox error={err} />
        {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</div>}
        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : mode === 'magic' ? 'Email me a sign-in link' : 'Send reset link'}
        </button>
        <div className="flex justify-between text-xs text-gray-600">
          {mode !== 'password' ? <button type="button" className="underline" onClick={() => setMode('password')}>Use password</button>
            : <button type="button" className="underline" onClick={() => setMode('magic')}>Email me a link instead</button>}
          {mode !== 'reset' && <button type="button" className="underline" onClick={() => setMode('reset')}>Forgot password?</button>}
        </div>
        <p className="text-xxs text-gray-400">Use your Mantis Hub / client portal login. Personal information is processed in line with POPIA.</p>
      </form>
    </div>
  );
}

export function SetPasswordPage({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr('The passwords do not match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message); else onDone();
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form onSubmit={save} className="card w-full max-w-sm space-y-3 p-6">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <label className="block"><span className="label">New password</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="block"><span className="label">Repeat password</span><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <ErrorBox error={err} />
        <button className="btn-primary w-full justify-center" disabled={busy}>Save password</button>
      </form>
    </div>
  );
}
