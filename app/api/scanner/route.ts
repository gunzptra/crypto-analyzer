import { NextResponse } from "next/server";
import { fetch24hTickers, fetchKlines } from "@/lib/binance";
import { analyzeTimeframe, combineScores, qualityAdjustedScore, riskScore, setupStatus, tradeLevels } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stablecoins, fiat proxies and wrapped/derivative assets are excluded because
// this scanner is intended to rank directional crypto opportunities, not pegs.
const EXCLUDED_BASES = new Set([
  "USDC","FDUSD","TUSD","USDP","DAI","EUR","TRY","BRL","AEUR","EURI","BIDR","IDRT",
  "USD1","USDE","PYUSD","GUSD","LUSD","FRAX","CRVUSD","USTC","USDS","USDX","SUSD",
  "WBTC","WBETH","WETH","BTCB","ETHW","STETH","WSTETH","RETH","CBETH",
]);

function validUsdt(symbol: string) {
  if (!symbol.endsWith("USDT")) return false;
  const base = symbol.slice(0, -4).toUpperCase();
  if (!base || EXCLUDED_BASES.has(base)) return false;
  if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return false;
  if (/^(1000)?(USDC|FDUSD|TUSD|DAI|USD1|USDE|PYUSD)$/.test(base)) return false;
  return true;
}

export async function GET() {
  try {
    const tickers = await fetch24hTickers();
    const liquid = tickers
      .filter((t) => validUsdt(t.symbol))
      .filter((t) => Number(t.quoteVolume) > 15_000_000)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, 30);

    const results: Array<any | null> = [];
    const concurrency = 6;

    for (let i = 0; i < liquid.length; i += concurrency) {
      const batch = liquid.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (t) => {
          try {
            const [d1, h4] = await Promise.all([
              fetchKlines(t.symbol, "1d", 220),
              fetchKlines(t.symbol, "4h", 220),
            ]);
            const oneDay = analyzeTimeframe(d1, "1D");
            const fourHour = analyzeTimeframe(h4, "4H");
            const change24h = Number(t.priceChangePercent);
            const quoteVolume = Number(t.quoteVolume);
            const score = combineScores(oneDay, fourHour, change24h, quoteVolume);
            const risk = riskScore(fourHour, change24h, quoteVolume);
            const qualityScore = qualityAdjustedScore(score, risk, fourHour.volumeRatio, change24h, fourHour.rsi14);
            const status = setupStatus({ quality: qualityScore, opportunity: score, risk, rsi4h: fourHour.rsi14, volumeRatio: fourHour.volumeRatio, trend1d: oneDay.trend, trend4h: fourHour.trend, change24h });
            const levels = tradeLevels(fourHour);
            return {
              symbol: t.symbol,
              base: t.symbol.replace("USDT", ""),
              price: Number(t.lastPrice),
              change24h,
              quoteVolume,
              score,
              qualityScore,
              risk,
              riskLabel: risk >= 67 ? "High" : risk >= 42 ? "Medium" : "Low",
              setupStatus: status,
              trend1d: oneDay.trend,
              trend4h: fourHour.trend,
              rsi4h: fourHour.rsi14,
              volumeRatio4h: fourHour.volumeRatio,
              atrPct4h: fourHour.atrPct,
              levels,
              reasons: [...oneDay.reasons.slice(0, 3), ...fourHour.reasons.slice(0, 4)],
            };
          } catch (error) {
            console.warn(`Scanner skipped ${t.symbol}:`, error);
            return null;
          }
        })
      );
      results.push(...batchResults);
    }

    const items = results.filter(Boolean).sort((a: any, b: any) => b.qualityScore - a.qualityScore || b.score - a.score);
    const btc = items.find((x: any) => x.symbol === "BTCUSDT");
    const eth = items.find((x: any) => x.symbol === "ETHUSDT");
    const bullishCount = items.filter((x: any) => x.trend1d === "Bullish").length;
    const marketScore = items.length ? Math.round(items.reduce((s: number, x: any) => s + x.qualityScore, 0) / items.length) : 50;
    const qualifiedCount = items.filter((x: any) => x.setupStatus === "QUALIFIED").length;
    const avgRsi = items.length ? items.reduce((s: number, x: any) => s + (x.rsi4h ?? 50), 0) / items.length : 50;
    const entryEnvironment = qualifiedCount >= 5 && avgRsi < 72 ? "Favorable" : qualifiedCount >= 1 ? "Selective" : "Wait";

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      market: {
        score: marketScore,
        regime: marketScore >= 65 ? "Risk-On" : marketScore <= 42 ? "Risk-Off" : "Neutral",
        btcTrend: btc?.trend1d || "Unknown",
        ethTrend: eth?.trend1d || "Unknown",
        bullishCount,
        scanned: items.length,
        qualifiedCount,
        entryEnvironment,
      },
      items,
      methodology: "V1.2 Quality ranking = 70% technical opportunity + 20% inverse risk + 10% volume confirmation, with RSI overextension and anti-chasing penalties. QUALIFIED additionally requires aligned bullish 1D/4H, risk < 70, RSI 4H < 78 and relative volume >= 0.60x. It is not a probability of profit.",
    }, { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scanner failed" }, { status: 500 });
  }
}
