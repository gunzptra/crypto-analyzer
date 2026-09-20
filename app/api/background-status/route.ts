import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ configured: false, jobs: {} });
  const { data, error } = await supabase.from('background_runs').select('job,status,processed,started_at,finished_at,details').order('started_at', { ascending: false }).limit(20);
  if (error) return NextResponse.json({ configured: true, error: error.message, jobs: {} });
  const jobs: Record<string, any> = {};
  for (const row of data || []) if (!jobs[row.job]) jobs[row.job] = row;
  return NextResponse.json({ configured: true, jobs });
}
