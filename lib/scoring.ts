import { atr, ema, macd, rsi, sma, supportResistance, type Candle } from "./indicators";

export type Trend = "Bullish" | "Bearish" | "Neutral";
export type SetupStatus = "QUALIFIED" | "WATCH" | "WAIT FOR PULLBACK" | "OVEREXTENDED" | "HIGH RISK" | "AVOID";

export type TimeframeAnalysis = {
  interval: string;
  close: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  support: number;
  resistance: number;
  trend: Trend;
  score: number;
  reasons: string[];
};

export function analyzeTimeframe(candles: Candle[], interval: string): TimeframeAnalysis {
  const completedCandles = candles.length > 1 ? candles.slice(0, -1) : candles;
  const closes = completedCandles.map((c) => c.close);
  const volumes = completedCandles.map((c) => c.volume);
  const close = closes.at(-1) || 0;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(completedCandles, 14);
  const atrPct = a && close ? (a / close) * 100 : null;
  const avgVol = sma(volumes.slice(0, -1), 20);
  const currentVol = volumes.at(-1) || 0;
  const volumeRatio = avgVol ? currentVol / avgVol : null;
  const { support, resistance } = supportResistance(completedCandles, 30);

  let score = 50;
  const reasons: string[] = [];

  if (e20 && e50 && close > e20 && e20 > e50) {
    score += 12;
    reasons.push(`Harga > EMA20 > EMA50 (${interval})`);
  } else if (e20 && e50 && close < e20 && e20 < e50) {
    score -= 12;
    reasons.push(`Harga < EMA20 < EMA50 (${interval})`);
  } else reasons.push(`Susunan EMA20/EMA50 belum searah (${interval})`);

  if (e200) {
    if (close > e200) { score += 8; reasons.push(`Harga di atas EMA200 (${interval})`); }
    else { score -= 8; reasons.push(`Harga di bawah EMA200 (${interval})`); }
  }

  if (r != null) {
    if (r >= 52 && r <= 68) {
      score += 8;
      reasons.push(`RSI ${r.toFixed(1)}: momentum positif`);
    } else if (r > 80) {
      score -= 14;
      reasons.push(`RSI ${r.toFixed(1)}: sangat overextended`);
    } else if (r > 75) {
      score -= 10;
      reasons.push(`RSI ${r.toFixed(1)}: overbought kuat`);
    } else if (r > 70) {
      score -= 5;
      reasons.push(`RSI ${r.toFixed(1)}: mulai overextended`);
    } else if (r < 40) {
      score -= 6;
      reasons.push(`RSI ${r.toFixed(1)}: momentum masih lemah`);
    } else reasons.push(`RSI ${r.toFixed(1)}: area netral`);
  }

  if (m.histogram != null) {
    if (m.histogram > 0) { score += 7; reasons.push(`MACD histogram positif (${interval})`); }
    else { score -= 5; reasons.push(`MACD histogram negatif (${interval})`); }
  }

  if (volumeRatio != null) {
    if (volumeRatio >= 1.2) {
      score += 8;
      reasons.push(`Volume kuat/confirmed: ${volumeRatio.toFixed(2)}x`);
    } else if (volumeRatio >= 0.9) {
      score += 3;
      reasons.push(`Volume cukup sehat: ${volumeRatio.toFixed(2)}x`);
    } else if (volumeRatio >= 0.6) {
      reasons.push(`Volume moderat: ${volumeRatio.toFixed(2)}x`);
    } else {
      score -= 7;
      reasons.push(`Volume lemah: ${volumeRatio.toFixed(2)}x`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const trend: Trend = score >= 65 ? "Bullish" : score <= 40 ? "Bearish" : "Neutral";
  return { interval, close, ema20: e20, ema50: e50, ema200: e200, rsi14: r, macdHistogram: m.histogram, atr14: a, atrPct, volumeRatio, support, resistance, trend, score, reasons };
}

export function combineScores(oneDay: TimeframeAnalysis, fourHour: TimeframeAnalysis, change24h: number, quoteVolume: number) {
  let score = oneDay.score * 0.55 + fourHour.score * 0.45;
  if (change24h > 20) score -= 16;
  else if (change24h > 15) score -= 11;
  else if (change24h > 10) score -= 5;
  else if (change24h > 3) score += 2;
  if (change24h < -10) score -= 8;
  score += quoteVolume >= 500_000_000 ? 5 : quoteVolume >= 150_000_000 ? 3 : quoteVolume >= 50_000_000 ? 1 : 0;
  if (oneDay.trend === "Bullish" && fourHour.trend === "Bullish") score += 4;
  if (oneDay.trend === "Bearish" && fourHour.trend === "Bearish") score -= 4;
  if (oneDay.trend !== fourHour.trend && oneDay.trend !== "Neutral" && fourHour.trend !== "Neutral") score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function riskScore(a: TimeframeAnalysis, change24h: number, quoteVolume: number) {
  let risk = 46;
  if (a.atrPct != null) {
    if (a.atrPct > 8) risk += 26;
    else if (a.atrPct > 6) risk += 19;
    else if (a.atrPct > 4) risk += 12;
    else if (a.atrPct > 2.5) risk += 4;
    else if (a.atrPct < 1.5) risk -= 8;
  }
  if (Math.abs(change24h) > 20) risk += 20;
  else if (Math.abs(change24h) > 15) risk += 14;
  else if (Math.abs(change24h) > 8) risk += 8;
  if (quoteVolume < 25_000_000) risk += 18;
  else if (quoteVolume < 50_000_000) risk += 8;
  else if (quoteVolume > 500_000_000) risk -= 10;
  else if (quoteVolume > 250_000_000) risk -= 6;
  return Math.max(0, Math.min(100, Math.round(risk)));
}

function volumeQuality(v: number | null) {
  if (v == null) return 40;
  if (v >= 1.5) return 100;
  if (v >= 1.2) return 90;
  if (v >= 0.9) return 75;
  if (v >= 0.6) return 52;
  return 22;
}

export function qualityAdjustedScore(opportunity: number, risk: number, volumeRatio: number | null, change24h: number, rsi4h: number | null) {
  let quality = opportunity * 0.7 + (100 - risk) * 0.2 + volumeQuality(volumeRatio) * 0.1;
  if (volumeRatio != null && volumeRatio < 0.6) quality -= 5;
  if (change24h > 12) quality -= Math.min(10, (change24h - 12) * 0.7);
  if (rsi4h != null) {
    if (rsi4h > 80) quality -= 10;
    else if (rsi4h > 75) quality -= 6;
    else if (rsi4h > 70) quality -= 3;
  }
  return Math.max(0, Math.min(100, Math.round(quality)));
}

export function setupStatus(args: { quality: number; opportunity: number; risk: number; rsi4h: number | null; volumeRatio: number | null; trend1d: Trend; trend4h: Trend; change24h: number; }): SetupStatus {
  const { quality, opportunity, risk, rsi4h, volumeRatio, trend1d, trend4h, change24h } = args;
  if (risk >= 70) return "HIGH RISK";
  if ((rsi4h ?? 0) > 80 || change24h > 18) return "OVEREXTENDED";
  if ((rsi4h ?? 0) > 75 || change24h > 12) return "WAIT FOR PULLBACK";
  if (trend1d === "Bearish" || trend4h === "Bearish") return quality >= 65 ? "WATCH" : "AVOID";
  if (quality >= 70 && opportunity >= 70 && risk < 70 && (volumeRatio ?? 0) >= 0.6 && (rsi4h ?? 50) < 78 && trend1d === "Bullish" && trend4h === "Bullish") return "QUALIFIED";
  if (quality >= 60 && opportunity >= 65) return "WATCH";
  return "AVOID";
}

export function tradeLevels(a: TimeframeAnalysis) {
  const price = a.close;
  const atrVal = a.atr14 || price * 0.025;
  const entryLow = Math.max(a.support, price - atrVal * 0.55);
  const entryHigh = price;
  const stopCandidate = a.support - atrVal * 0.25;
  const atrStop = price - atrVal * 1.25;
  const stop = Math.max(0, Math.min(stopCandidate, atrStop));
  const unitRisk = Math.max(price - stop, atrVal * 0.7);
  const tp1 = price + unitRisk * 1.5;
  const tp2 = price + unitRisk * 2.5;
  return { entryLow, entryHigh, stop, tp1, tp2, rr: 2.5 };
}
