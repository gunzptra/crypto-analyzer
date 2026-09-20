import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CoinGeckoPrice = {
  idr?: number;
  idr_24h_change?: number;
  last_updated_at?: number;
};

function cleanSymbols(raw: string | null) {
  const incoming = (raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => s.replace(/[^a-z0-9]/g, ""));
  return Array.from(new Set(["usdt", ...incoming])).slice(0, 50);
}

export async function GET(req: NextRequest) {
  const symbols = cleanSymbols(req.nextUrl.searchParams.get("symbols"));
  const key = process.env.COINGECKO_API_KEY?.trim();
  const base = (process.env.COINGECKO_API_BASE || "https://api.coingecko.com/api/v3").replace(/\/$/, "");
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    vs_currencies: "idr",
    include_24hr_change: "true",
    include_last_updated_at: "true",
    precision: "full",
  });

  try {
    const headers: HeadersInit = { accept: "application/json" };
    if (key) headers["x-cg-demo-api-key"] = key;

    const response = await fetch(`${base}/simple/price?${params.toString()}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`CoinGecko HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }

    const raw = (await response.json()) as Record<string, CoinGeckoPrice>;
    const prices: Record<string, { idr: number; change24h: number | null; lastUpdatedAt: number | null }> = {};

    for (const [symbol, value] of Object.entries(raw)) {
      if (!value || !Number.isFinite(Number(value.idr))) continue;
      prices[symbol.toUpperCase()] = {
        idr: Number(value.idr),
        change24h: Number.isFinite(Number(value.idr_24h_change)) ? Number(value.idr_24h_change) : null,
        lastUpdatedAt: Number.isFinite(Number(value.last_updated_at)) ? Number(value.last_updated_at) : null,
      };
    }

    const usdtIdr = prices.USDT?.idr || null;
    return NextResponse.json({
      ok: true,
      source: "CoinGecko",
      quote: "IDR",
      usdtIdr,
      prices,
      requestedSymbols: symbols.map((s) => s.toUpperCase()),
      fetchedAt: new Date().toISOString(),
      authenticated: Boolean(key),
    }, { headers: { "Cache-Control": "public, s-maxage=45, stale-while-revalidate=90" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      source: "CoinGecko",
      error: error instanceof Error ? error.message : "Gagal mengambil harga IDR CoinGecko",
      prices: {},
      usdtIdr: null,
      fetchedAt: new Date().toISOString(),
    }, { status: 502 });
  }
}
