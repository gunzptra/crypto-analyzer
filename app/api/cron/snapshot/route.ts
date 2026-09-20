import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, requireCronSecret } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fourHourSlot(d = new Date()) {
  const hour = Math.floor(d.getUTCHours() / 4) * 4;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0));
}

export async function GET(req: Request) {
  const auth = requireCronSecret(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.reason === 'Unauthorized' ? 401 : 503 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase admin is not configured' }, { status: 503 });

  const startedAt = new Date();
  let runId: string | null = null;
  try {
    const { data: run } = await supabase.from('background_runs').insert({ job: 'snapshot', status: 'RUNNING', started_at: startedAt.toISOString() }).select('id').single();
    runId = run?.id || null;

    const origin = new URL(req.url).origin;
    const scannerRes = await fetch(`${origin}/api/scanner`, { cache: 'no-store' });
    const scanner = await scannerRes.json();
    if (!scannerRes.ok) throw new Error(scanner.error || 'Scanner failed');

    const slot = fourHourSlot();
    const rows = (scanner.items || []).map((x: any) => ({
      symbol: x.symbol,
      timeframe: '4h',
      price: x.price,
      opportunity_score: x.score,
      quality_score: x.qualityScore,
      risk_score: x.risk,
      setup_status: x.setupStatus,
      payload: { ...x, market: scanner.market },
      scanned_at: scanner.updatedAt || new Date().toISOString(),
      scan_slot: slot.toISOString(),
    }));
    const { error } = await supabase.from('scan_snapshots').upsert(rows, { onConflict: 'symbol,timeframe,scan_slot' });
    if (error) throw error;

    const finishedAt = new Date();
    if (runId) await supabase.from('background_runs').update({ status: 'SUCCESS', processed: rows.length, details: { slot: slot.toISOString() }, finished_at: finishedAt.toISOString() }).eq('id', runId);
    return NextResponse.json({ ok: true, processed: rows.length, slot: slot.toISOString() });
  } catch (error) {
    if (runId) await supabase.from('background_runs').update({ status: 'FAILED', details: { error: error instanceof Error ? error.message : 'failed' }, finished_at: new Date().toISOString() }).eq('id', runId);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Snapshot job failed' }, { status: 500 });
  }
}
