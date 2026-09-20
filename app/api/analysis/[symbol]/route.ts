import { NextResponse } from "next/server";
import { fetchKlines } from "@/lib/binance";
import { analyzeTimeframe, tradeLevels } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol: raw } = await params;
    const symbol = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol.endsWith("USDT")) return NextResponse.json({ error: "Only USDT pairs are supported" }, { status: 400 });

    const [h1, h4, d1] = await Promise.all([
      fetchKlines(symbol, "1h", 220),
      fetchKlines(symbol, "4h", 220),
      fetchKlines(symbol, "1d", 220),
    ]);
    const tf1h = analyzeTimeframe(h1, "1H");
    const tf4h = analyzeTimeframe(h4, "4H");
    const tf1d = analyzeTimeframe(d1, "1D");

    const alignment = [tf1h.trend, tf4h.trend, tf1d.trend];
    const bullish = alignment.filter((x) => x === "Bullish").length;
    const bearish = alignment.filter((x) => x === "Bearish").length;
    const setupStatus = bullish === 3 ? "Aligned Bullish" : bearish === 3 ? "Aligned Bearish" : bullish >= 2 ? "Bullish Bias" : bearish >= 2 ? "Bearish Bias" : "Mixed / Wait";

    return NextResponse.json({
      symbol,
      setupStatus,
      timeframes: { "1h": tf1h, "4h": tf4h, "1d": tf1d },
      levels: tradeLevels(tf4h),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed" }, { status: 500 });
  }
}
