import { NextResponse } from 'next/server';
import { evaluatePaperTrade } from '@/lib/paper-evaluator';
import { getSupabaseAdminClient, requireCronSecret } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = requireCronSecret(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.reason === 'Unauthorized' ? 401 : 503 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase admin is not configured' }, { status: 503 });

  const startedAt = new Date();
  let runId: string | null = null;
  try {
    const { data: run } = await supabase.from('background_runs').insert({ job: 'validate', status: 'RUNNING', started_at: startedAt.toISOString() }).select('id').single();
    runId = run?.id || null;

    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data: trades, error } = await supabase.from('paper_trades').select('*').eq('status', 'OPEN').lte('opened_at', cutoff).order('opened_at', { ascending: true }).limit(50);
    if (error) throw error;

    let processed = 0;
    const failures: string[] = [];
    for (const t of trades || []) {
      try {
        const evaluation = await evaluatePaperTrade({
          symbol: t.symbol,
          openedAt: new Date(t.opened_at).getTime(),
          entry: Number(t.entry),
          stop: Number(t.stop),
          tp1: Number(t.tp1),
          tp2: Number(t.tp2),
        });
        const { error: updateError } = await supabase.from('paper_trades').update({ evaluation, updated_at: new Date().toISOString() }).eq('id', t.id);
        if (updateError) throw updateError;
        processed++;
      } catch (e) {
        failures.push(`${t.symbol}:${e instanceof Error ? e.message : 'failed'}`);
      }
    }

    const finishedAt = new Date();
    if (runId) await supabase.from('background_runs').update({ status: failures.length ? 'PARTIAL' : 'SUCCESS', processed, details: { failures }, finished_at: finishedAt.toISOString() }).eq('id', runId);
    return NextResponse.json({ ok: true, processed, failures, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() });
  } catch (error) {
    if (runId) await supabase.from('background_runs').update({ status: 'FAILED', details: { error: error instanceof Error ? error.message : 'failed' }, finished_at: new Date().toISOString() }).eq('id', runId);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Background validation failed' }, { status: 500 });
  }
}
