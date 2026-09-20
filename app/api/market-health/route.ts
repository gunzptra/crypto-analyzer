import { NextResponse } from "next/server";
import { pingBinance } from "@/lib/binance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await pingBinance();
    return NextResponse.json({ ...result, source: "Binance public market data" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Market data connection failed" },
      { status: 503 }
    );
  }
}
