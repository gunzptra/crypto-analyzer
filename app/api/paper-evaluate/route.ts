import { NextResponse } from 'next/server';
import { evaluatePaperTrade } from '@/lib/paper-evaluator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const symbol = (u.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const openedAt = Number(u.searchParams.get('openedAt'));
    const entry = Number(u.searchParams.get('entry'));
    const stop = Number(u.searchParams.get('stop'));
    const tp1 = Number(u.searchParams.get('tp1'));
    const tp2 = Number(u.searchParams.get('tp2'));
    if (!symbol.endsWith('USDT') || !openedAt || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || !Number.isFinite(tp1) || !Number.isFinite(tp2)) {
      return NextResponse.json({ error: 'Invalid paper trade parameters' }, { status: 400 });
    }
    return NextResponse.json(await evaluatePaperTrade({ symbol, openedAt, entry, stop, tp1, tp2 }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Paper trade evaluation failed' }, { status: 500 });
  }
}
