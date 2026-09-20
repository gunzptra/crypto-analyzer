import type { Candle } from "./indicators";

/**
 * Public market-data endpoints only. Binance recommends data-api.binance.vision
 * for endpoints with security type NONE. We keep several fallbacks because
 * DNS/ISP/corporate networks can block one hostname while allowing another.
 */
const CUSTOM_BASE = process.env.BINANCE_REST_BASE?.replace(/\/$/, "");
const BASES = Array.from(new Set([
  "https://data-api.binance.vision",
  CUSTOM_BASE,
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
].filter(Boolean) as string[]));

async function fetchWithTimeout(url: string, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "crypto-trading-intelligence-v1",
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const errors: string[] = [];

  for (const base of BASES) {
    try {
      const res = await fetchWithTimeout(`${base}${path}`);
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        errors.push(`${base}: HTTP ${res.status}${body ? ` ${body}` : ""}`);
        continue;
      }
      return (await res.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${base}: ${message}`);
    }
  }

  throw new Error(
    `Tidak dapat terhubung ke Binance public market data. Coba buka https://data-api.binance.vision/api/v3/ping dari browser. Detail: ${errors.join(" | ")}`
  );
}

export type Ticker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
};

export async function fetch24hTickers() {
  return getJson<Ticker24h[]>("/api/v3/ticker/24hr");
}

export async function fetchKlines(
  symbol: string,
  interval: "1h" | "4h" | "1d",
  limit = 220
): Promise<Candle[]> {
  const rows = await getJson<any[]>(
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
  );

  return rows.map((r) => ({
    openTime: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

export async function pingBinance() {
  const startedAt = Date.now();
  await getJson<Record<string, never>>("/api/v3/ping");
  return { ok: true, latencyMs: Date.now() - startedAt };
}
