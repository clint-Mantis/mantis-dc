// dc-invite: Mantis admins invite a new user by email and (optionally) give them an org membership.
// POST { email, full_name?, org_id?, role?, redirect_to? }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json, userClient } from '../_shared/supa.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = userClient(req);
    const { data: ctx, error } = await sb.rpc('dc_my_context');
    if (error || !ctx?.is_admin) return json({ error: 'Only Mantis admins can invite users' }, 403);
    const { email, full_name, org_id, role, redirect_to } = await req.json();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email address is required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    let userId: string | undefined;
    const invited = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: redirect_to });
    if (invited.error) {
      // already registered (e.g. a Mantis Hub user): find them instead
      const { data: found } = await sb.rpc('dc_list_users', { p_q: email, p_limit: 5 });
      userId = (found as { id: string; email: string }[] | null)?.find((u) => u.email.toLowerCase() === email.toLowerCase())?.id;
      if (!userId) return json({ error: invited.error.message }, 400);
    } else userId = invited.data.user?.id;

    if (full_name && userId) await admin.from('dc_profiles').upsert({ user_id: userId, full_name });
    if (org_id && role && userId) {
      const { error: mErr } = await sb.from('dc_memberships').upsert({ user_id: userId, org_id, role });
      if (mErr) return json({ error: mErr.message }, 400);
    }
    return json({ user_id: userId, invited: !invited.error });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
