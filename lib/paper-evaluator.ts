import { fetchKlines } from '@/lib/binance';

const HOUR = 60 * 60 * 1000;
const CHECKPOINTS = [
  { key: '4h', hours: 4 },
  { key: '12h', hours: 12 },
  { key: '24h', hours: 24 },
  { key: '3d', hours: 72 },
  { key: '7d', hours: 168 },
] as const;

type Input = { symbol: string; openedAt: number; entry: number; stop: number; tp1: number; tp2: number };

type Checkpoint = {
  targetHours: number;
  reached: boolean;
  candleTime: number | null;
  close: number | null;
  returnPct: number | null;
  mfePct: number | null;
  maePct: number | null;
};

export async function evaluatePaperTrade(input: Input) {
  const { symbol, openedAt, entry, stop, tp1, tp2 } = input;
  const candles = await fetchKlines(symbol, '1h', 500);
  const relevant = candles.filter((c) => c.openTime >= openedAt).slice(0, -1);
  let tp1At: number | null = null;
  let tp2At: number | null = null;
  let stopAt: number | null = null;
  let ambiguousAt: number | null = null;
  let maxHigh = 0;
  let minLow = Number.POSITIVE_INFINITY;

  for (const c of relevant) {
    maxHigh = Math.max(maxHigh, c.high);
    minLow = Math.min(minLow, c.low);
    const hitStop = c.low <= stop;
    const hit1 = c.high >= tp1;
    const hit2 = c.high >= tp2;
    if (!tp1At && !stopAt && hitStop && hit1) { ambiguousAt = c.openTime; break; }
    if (!tp1At && !stopAt && hitStop) { stopAt = c.openTime; break; }
    if (!tp1At && hit1) tp1At = c.openTime;
    if (tp1At && !tp2At && hit2) { tp2At = c.openTime; break; }
    if (tp1At && !tp2At && hitStop) break;
  }

  const checkpoints = Object.fromEntries(CHECKPOINTS.map(({ key, hours }) => {
    const target = openedAt + hours * HOUR;
    const upto = relevant.filter((c) => c.openTime + HOUR <= target);
    if (!upto.length || Date.now() < target) {
      const pending: Checkpoint = { targetHours: hours, reached: false, candleTime: null, close: null, returnPct: null, mfePct: null, maePct: null };
      return [key, pending];
    }
    const last = upto.at(-1)!;
    const high = Math.max(...upto.map((c) => c.high));
    const low = Math.min(...upto.map((c) => c.low));
    const point: Checkpoint = {
      targetHours: hours,
      reached: true,
      candleTime: last.openTime,
      close: last.close,
      returnPct: ((last.close - entry) / entry) * 100,
      mfePct: ((high - entry) / entry) * 100,
      maePct: ((low - entry) / entry) * 100,
    };
    return [key, point];
  }));

  const outcome = ambiguousAt ? 'AMBIGUOUS' : stopAt && !tp1At ? 'STOP_HIT' : tp2At ? 'TP2_HIT' : tp1At ? 'TP1_HIT' : 'OPEN';
  return {
    symbol, outcome, tp1At, tp2At, stopAt, ambiguousAt,
    maxHigh: maxHigh || null,
    minLow: Number.isFinite(minLow) ? minLow : null,
    candlesChecked: relevant.length,
    checkpoints,
    evaluatedAt: new Date().toISOString(),
  };
}
