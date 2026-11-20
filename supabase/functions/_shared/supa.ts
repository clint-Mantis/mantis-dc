// Shared helpers for DC Edge Functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Meta } from './engine.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Client that acts as the calling user, so every query goes through RLS. */
export function userClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  return createClient(url, key, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadMeta(sb: SupabaseClient): Promise<Meta> {
  const [p, d, r, l] = await Promise.all([
    sb.from('dc_pillars').select('*').order('sort'),
    sb.from('dc_field_defs').select('*').order('sort'),
    sb.from('dc_field_rules').select('*'),
    sb.from('dc_lookups').select('*').order('sort'),
  ]);
  for (const x of [p, d, r, l]) if (x.error) throw new Error(x.error.message);
  return { pillars: p.data!, defs: d.data!.map((x) => ({ ...x, min_value: x.min_value === null ? null : Number(x.min_value), max_value: x.max_value === null ? null : Number(x.max_value) })), rules: r.data!, lookups: l.data! };
}

/** Load every row of a table for an org (paged, PostgREST caps at 1000 rows per request). */
export async function selectAll(sb: SupabaseClient, table: string, columns: string, filter: [string, string]) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).eq(filter[0], filter[1]).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
