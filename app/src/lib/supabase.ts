import { createClient } from '@supabase/supabase-js';

// Public project values. Access control is enforced in the database (RLS), never in the browser.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://lneidlowcjfxpunkwotm.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_dQHWSS-DcqgqxV0m-XuIwA_LGsuk5na';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'mantis-dc-auth' },
});

/** Throws a readable error for a Supabase response. */
export function unwrap<T>(res: { data: T | null; error: { message: string; details?: string; hint?: string } | null }): T {
  if (res.error) throw new Error(friendlyError(res.error));
  return res.data as T;
}

export function friendlyError(e: { message: string; details?: string; hint?: string; code?: string }): string {
  const m = e.message ?? String(e);
  if (/row-level security|violates row-level/i.test(m)) return 'You do not have permission to do that (or the pillar is locked).';
  if (/dc_people_org_id_number_uq/.test(m)) return 'A person with this ID number already exists for this organisation.';
  if (/dc_suppliers_vendor_uq/.test(m)) return 'A supplier with this vendor number already exists.';
  if (/violates foreign key constraint/i.test(m) && /delete/i.test(m)) return 'This record is still used elsewhere and cannot be deleted.';
  if (/violates check constraint/i.test(m)) return `A value is out of range (${m.replace(/.*constraint "([^"]+)".*/, '$1')}).`;
  return m;
}

/** Call an Edge Function and return JSON, or a Blob for file downloads. */
export async function callFunction<T = unknown>(name: string, body: unknown, asBlob = false): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.error ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return (asBlob ? await res.blob() : await res.json()) as T;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
