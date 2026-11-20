import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp, roleLabel } from '../lib/context';
import { supabase, unwrap } from '../lib/supabase';

function OrgSwitcher() {
  const { me, org, setOrg } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const searchAll = !!(me?.is_admin || me?.is_staff);
  const search = useQuery({
    queryKey: ['org-search', q],
    enabled: open && searchAll && q.length >= 2,
    queryFn: async () => unwrap(await supabase.rpc('dc_search_orgs', { p_q: q, p_limit: 25 })) as { id: string; name: string }[],
  });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!me) return null;
  const mine = me.orgs.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  const recent = me.recent_orgs.filter((o) => !mine.some((m) => m.id === o.id) && (!q || o.name.toLowerCase().includes(q.toLowerCase())));
  const pick = (o: { id: string; name: string; role?: string }) => { setOrg(o); setOpen(false); setQ(''); };
  return (
    <div className="relative" ref={box}>
      <button className="flex items-center gap-2 rounded border border-white/20 px-3 py-1 text-sm hover:bg-white/10" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="text-white/60">Organisation:</span>
        <span className="max-w-[260px] truncate font-semibold">{org?.name ?? 'Choose…'}</span>▾
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-96 rounded border bg-white text-ink shadow-xl">
          <div className="p-2"><input className="input" autoFocus placeholder={searchAll ? 'Search all organisations…' : 'Filter…'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <ul role="listbox" className="max-h-80 overflow-y-auto pb-1 text-sm">
            {mine.map((o) => (
              <li key={o.id}><button className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => pick(o)}>
                <span className="truncate">{o.name}</span><span className="text-xs text-gray-500">{roleLabel[o.role?.replace('project_', '') ?? ''] ?? ''}</span></button></li>
            ))}
            {recent.length > 0 && <li className="px-3 pt-2 text-xxs font-semibold uppercase text-gray-400">Organisations with projects</li>}
            {recent.map((o) => <li key={o.id}><button className="w-full truncate px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => pick(o)}>{o.name}</button></li>)}
            {search.data && search.data.length > 0 && <li className="px-3 pt-2 text-xxs font-semibold uppercase text-gray-400">All Mantis Hub organisations</li>}
            {search.data?.filter((o) => !mine.some((m) => m.id === o.id) && !recent.some((m) => m.id === o.id)).map((o) => (
              <li key={o.id}><button className="w-full truncate px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => pick(o)}>{o.name}</button></li>
            ))}
            {searchAll && q.length < 2 && <li className="px-3 py-2 text-xs text-gray-400">Type 2+ letters to search every organisation</li>}
            {!mine.length && !recent.length && !search.data?.length && q.length >= 2 && <li className="px-3 py-2 text-xs text-gray-500">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me } = useApp();
  const nav = ({ isActive }: { isActive: boolean }) => `px-3 py-1 rounded text-sm ${isActive ? 'bg-white/15 font-semibold' : 'hover:bg-white/10'}`;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-ink text-white shadow">
        <div className="flex items-center gap-4 px-4 py-2">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="rounded bg-brand px-1.5 py-0.5 text-xs">DC</span> Mantis Data Capture
          </Link>
          <nav className="flex gap-1">
            <NavLink to="/" end className={nav}>Projects</NavLink>
            {me?.is_admin && <NavLink to="/admin" className={nav}>Admin</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <OrgSwitcher />
            <NavLink to="/profile" className={nav} title={me?.email}>{me?.profile?.full_name || me?.email || 'Profile'}</NavLink>
            <button className="text-sm text-white/70 hover:text-white" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
