import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from './supabase';
import type { Meta, Pillar, FieldDef, FieldRule, Lookup } from '@engine';

export interface OrgRef { id: string; name: string; role?: string }
export interface MyContext {
  user_id: string; email: string; is_admin: boolean; is_staff: boolean;
  profile: { full_name?: string; phone?: string } | null;
  orgs: OrgRef[]; recent_orgs: OrgRef[];
}

interface AppCtx {
  session: Session | null;
  me: MyContext | null;
  meLoading: boolean;
  org: OrgRef | null;
  setOrg: (o: OrgRef | null) => void;
  refreshMe: () => void;
}
const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
const ORG_KEY = 'mantis-dc-org';

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) qc.clear(); });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const meQ = useQuery({
    queryKey: ['me', session?.user.id],
    enabled: !!session,
    queryFn: async () => unwrap(await supabase.rpc('dc_my_context')) as MyContext,
  });

  const [org, setOrgState] = useState<OrgRef | null>(() => {
    try { return JSON.parse(localStorage.getItem(ORG_KEY) ?? 'null'); } catch { return null; }
  });
  const setOrg = (o: OrgRef | null) => {
    setOrgState(o);
    try { o ? localStorage.setItem(ORG_KEY, JSON.stringify(o)) : localStorage.removeItem(ORG_KEY); } catch { /* storage unavailable */ }
  };
  // default to the first organisation the user belongs to
  useEffect(() => {
    const me = meQ.data;
    if (!me) return;
    const all = [...me.orgs, ...me.recent_orgs];
    if (org && (me.is_admin || me.is_staff || all.some((o) => o.id === org.id))) return;
    setOrg(all[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQ.data]);

  const value = useMemo<AppCtx>(() => ({
    session, me: meQ.data ?? null, meLoading: !ready || (!!session && meQ.isLoading), org, setOrg,
    refreshMe: () => meQ.refetch(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [session, meQ.data, meQ.isLoading, ready, org]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

/** Field metadata, lookups and rules (cached for the session). */
export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Meta & { sectors: { code: string; name: string; active: boolean }[]; products: { id: string; code: string; name: string }[] }> => {
      const [p, d, r, l, s, pr] = await Promise.all([
        supabase.from('dc_pillars').select('*').order('sort'),
        supabase.from('dc_field_defs').select('*').order('sort'),
        supabase.from('dc_field_rules').select('*'),
        supabase.from('dc_lookups').select('*').order('sort'),
        supabase.from('dc_sector_codes').select('*').order('name'),
        supabase.from('dc_products').select('*').order('name'),
      ]);
      return {
        pillars: unwrap(p) as Pillar[],
        defs: (unwrap(d) as FieldDef[]).map((x) => ({ ...x, min_value: x.min_value === null ? null : Number(x.min_value), max_value: x.max_value === null ? null : Number(x.max_value) })),
        rules: unwrap(r) as FieldRule[],
        lookups: unwrap(l) as Lookup[],
        sectors: unwrap(s) as { code: string; name: string; active: boolean }[],
        products: unwrap(pr) as { id: string; code: string; name: string }[],
      };
    },
  });
}

export type ProjectRole = 'mantis_admin' | 'consultant' | 'client_editor' | 'client_viewer' | 'verifier' | null;
export const can = (role: ProjectRole | string | null | undefined) => ({
  capture: role === 'mantis_admin' || role === 'consultant' || role === 'client_editor',
  manage: role === 'mantis_admin' || role === 'consultant',
  verify: role === 'mantis_admin' || role === 'consultant' || role === 'verifier',
  full: role !== 'client_viewer' && !!role,
});
export const roleLabel: Record<string, string> = {
  mantis_admin: 'Mantis admin', consultant: 'Consultant', client_editor: 'Client editor', client_viewer: 'Client viewer', verifier: 'Verifier',
};
