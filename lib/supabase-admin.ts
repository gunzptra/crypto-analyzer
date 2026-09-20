import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: false as const, reason: 'CRON_SECRET is not configured' };
  const auth = req.headers.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!supplied || supplied !== expected) return { ok: false as const, reason: 'Unauthorized' };
  return { ok: true as const };
}
