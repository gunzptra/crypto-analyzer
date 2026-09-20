"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Bookmark, BookmarkCheck, Database, Download, FlaskConical, History, PlayCircle, RefreshCw, ShieldAlert, TrendingUp, XCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Trend = "Bullish" | "Bearish" | "Neutral";
type SetupStatus = "QUALIFIED" | "WATCH" | "WAIT FOR PULLBACK" | "OVEREXTENDED" | "HIGH RISK" | "AVOID";
type Item = {
  symbol: string; base: string; price: number; change24h: number; quoteVolume: number;
  score: number; qualityScore: number; risk: number; riskLabel: "Low" | "Medium" | "High";
  setupStatus: SetupStatus; trend1d: Trend; trend4h: Trend; rsi4h: number | null; volumeRatio4h: number | null; atrPct4h: number | null;
  levels: { entryLow: number; entryHigh: number; stop: number; tp1: number; tp2: number; rr: number }; reasons: string[];
};
type Payload = { updatedAt: string; market: { score: number; regime: string; btcTrend: string; ethTrend: string; bullishCount: number; scanned: number; qualifiedCount: number; entryEnvironment: string }; items: Item[]; methodology: string };
type TimeframeAnalysis = { interval: string; close: number; rsi14: number | null; macdHistogram: number | null; atrPct: number | null; volumeRatio: number | null; support: number; resistance: number; trend: Trend; score: number };
type DetailPayload = { symbol: string; setupStatus: string; timeframes: { "1h": TimeframeAnalysis; "4h": TimeframeAnalysis; "1d": TimeframeAnalysis }; levels: Item["levels"]; updatedAt: string };
type LivePrices = Record<string, { price: number; change: number }>;
type IdrPricePayload = {
  ok: boolean;
  source: string;
  quote: string;
  usdtIdr: number | null;
  prices: Record<string, { idr: number; change24h: number | null; lastUpdatedAt: number | null }>;
  fetchedAt: string;
  authenticated?: boolean;
  error?: string;
};
type Filter = "all" | "qualified" | "watch" | "lowrisk" | "watchlist";
type View = "scanner" | "trades" | "performance";
type BackgroundStatus = { configured: boolean; jobs: Record<string, { job: string; status: string; processed: number; started_at: string; finished_at: string | null; details?: Record<string, unknown> }>; error?: string };
type Checkpoint = { targetHours: number; reached: boolean; candleTime: number | null; close: number | null; returnPct: number | null; mfePct: number | null; maePct: number | null };
type Evaluation = { outcome: "OPEN" | "TP1_HIT" | "TP2_HIT" | "STOP_HIT" | "AMBIGUOUS"; tp1At: number | null; tp2At: number | null; stopAt: number | null; ambiguousAt: number | null; maxHigh: number | null; minLow: number | null; candlesChecked: number; checkpoints?: Record<"4h" | "12h" | "24h" | "3d" | "7d", Checkpoint>; evaluatedAt: string };
type PaperTrade = {
  id: string; symbol: string; base: string; openedAt: number; status: "OPEN" | "CLOSED";
  entry: number; stop: number; tp1: number; tp2: number; quantity: number; capitalIdr: number; riskPct: number; maxLossIdr: number; usdtIdr: number;
  qualityScore: number; opportunityScore: number; riskScore: number; setupStatus: SetupStatus; snapshot: { rsi4h: number | null; volumeRatio4h: number | null; trend1d: Trend; trend4h: Trend; change24h: number };
  evaluation?: Evaluation; closePrice?: number; closedAt?: number; realizedPnlIdr?: number;
};

function fmtPrice(n: number) { if (!Number.isFinite(n)) return "-"; if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 }); if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 }); return n.toLocaleString("en-US", { maximumFractionDigits: 8 }); }
function fmtVolume(n: number) { return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(1)}M`; }
function fmtIdr(n: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0); }
function fmtIdrPrice(n: number) {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `Rp${n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}
function badgeClass(v: string) { return /Bullish|Low|Risk-On|Aligned Bullish|QUALIFIED|Favorable|TP/.test(v) ? "good" : /Bearish|High|Risk-Off|Aligned Bearish|HIGH RISK|AVOID|STOP|OVEREXTENDED/.test(v) ? "bad" : "warn"; }
function parseIdr(v: string, fallback: number) { const cleaned = v.replace(/[^0-9]/g, ""); const out = Number(cleaned); return Number.isFinite(out) && out > 0 ? out : fallback; }
function rValue(outcome?: Evaluation["outcome"]): number | null { if (outcome === "TP2_HIT") return 2.5; if (outcome === "TP1_HIT") return 1.5; if (outcome === "STOP_HIT") return -1; return null; }
function ageHours(openedAt: number) { return Math.max(0, (Date.now() - openedAt) / 3_600_000); }
function bucketStats(trades: PaperTrade[], labeler: (t: PaperTrade) => string, order: string[]) {
  const map = new Map<string, number[]>();
  for (const t of trades) {
    const r = rValue(t.evaluation?.outcome);
    if (r == null) continue;
    const label = labeler(t);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(r);
  }
  return order.map((label) => {
    const vals = map.get(label) || [];
    const wins = vals.filter((x) => x > 0).length;
    const avgR = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
    return { label, sample: vals.length, winRate: vals.length ? wins / vals.length * 100 : 0, avgR };
  });
}

export default function Dashboard() {
  const [view, setView] = useState<View>("scanner");
  const [data, setData] = useState<Payload | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [selected, setSelected] = useState<Item | null>(null); const [detail, setDetail] = useState<DetailPayload | null>(null); const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all"); const [live, setLive] = useState<LivePrices>({}); const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistMode, setWatchlistMode] = useState<"supabase" | "local">("local"); const [message, setMessage] = useState("");
  const [capitalIdr, setCapitalIdr] = useState("10000000"); const [riskPct, setRiskPct] = useState("1"); const [usdtIdr, setUsdtIdr] = useState("16500");
  const [autoIdr, setAutoIdr] = useState(true); const [idrData, setIdrData] = useState<IdrPricePayload | null>(null); const [idrError, setIdrError] = useState(""); const [idrLoading, setIdrLoading] = useState(false);
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]); const [paperMode, setPaperMode] = useState<"supabase" | "local">("local"); const [evaluating, setEvaluating] = useState<string | null>(null); const [autoValidating, setAutoValidating] = useState(false); const autoValidationStarted = useRef(false);
  const [background, setBackground] = useState<BackgroundStatus | null>(null);
  const [supabaseError, setSupabaseError] = useState("");

  const load = useCallback(async () => { setLoading(true); setError(""); try { const r = await fetch("/api/scanner", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Gagal memuat scanner"); setData(j); setSelected((cur) => cur ? j.items.find((x: Item) => x.symbol === cur.symbol) || j.items[0] : j.items[0]); } catch (e) { setError(e instanceof Error ? e.message : "Gagal memuat data"); } finally { setLoading(false); } }, []);
  const loadDetail = useCallback(async (symbol: string) => { setDetailLoading(true); try { const r = await fetch(`/api/analysis/${symbol}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Detail analysis failed"); setDetail(j); } catch (e) { setMessage(e instanceof Error ? e.message : "Detail analysis failed"); } finally { setDetailLoading(false); } }, []);
  const loadIdrPrices = useCallback(async (symbols: string[]) => {
    if (!symbols.length) return;
    setIdrLoading(true); setIdrError("");
    try {
      const q = encodeURIComponent(Array.from(new Set(symbols.map((x) => x.toLowerCase()))).slice(0, 45).join(","));
      const r = await fetch(`/api/idr-prices?symbols=${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Gagal mengambil harga IDR");
      setIdrData(j);
    } catch (e) {
      setIdrError(e instanceof Error ? e.message : "Gagal mengambil harga IDR");
    } finally { setIdrLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]); useEffect(() => { if (selected?.symbol) loadDetail(selected.symbol); }, [selected?.symbol, loadDetail]);
  useEffect(() => {
    if (!data?.items.length) return;
    const symbols = data.items.map((x) => x.base);
    loadIdrPrices(symbols);
    const timer = setInterval(() => loadIdrPrices(symbols), 60_000);
    return () => clearInterval(timer);
  }, [data?.updatedAt, loadIdrPrices]);
  useEffect(() => {
    if (autoIdr && idrData?.usdtIdr && Number.isFinite(idrData.usdtIdr)) setUsdtIdr(String(Math.round(idrData.usdtIdr)));
  }, [autoIdr, idrData?.usdtIdr]);

  useEffect(() => {
    const configured = (process.env.NEXT_PUBLIC_BINANCE_WS_BASE || "").replace(/\/$/, ""); const bases = Array.from(new Set(["wss://data-stream.binance.vision", configured, "wss://stream.binance.com:9443", "wss://stream.binance.com:443"].filter(Boolean))); const streams = ["btcusdt@ticker", "ethusdt@ticker", "solusdt@ticker"].join("/");
    let ws: WebSocket | undefined; let stopped = false; let index = 0; let opened = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => { if (stopped || index >= bases.length) return; opened = false; try { ws = new WebSocket(`${bases[index]}/stream?streams=${streams}`); ws.onopen = () => { opened = true; }; ws.onmessage = (ev) => { const d = JSON.parse(ev.data).data; if (d?.s) setLive((p) => ({ ...p, [d.s]: { price: Number(d.c), change: Number(d.P) } })); }; ws.onerror = () => { if (!opened) ws?.close(); }; ws.onclose = () => { if (stopped) return; if (!opened) index++; timer = setTimeout(connect, opened ? 2500 : 300); }; } catch { index++; timer = setTimeout(connect, 300); } };
    connect(); return () => { stopped = true; if (timer) clearTimeout(timer); ws?.close(); };
  }, []);

  useEffect(() => {
    const localKey = "cti-watchlist-v1";
    const getLocal = () => { try { const p = JSON.parse(localStorage.getItem(localKey) || "[]"); return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
    const readLocal = () => { setWatchlist(getLocal()); setWatchlistMode("local"); };
    (async () => {
      const supabase = getSupabaseBrowserClient(); if (!supabase) return readLocal();
      try {
        let { data: s } = await supabase.auth.getSession();
        if (!s.session) { const sign = await supabase.auth.signInAnonymously(); if (sign.error) throw sign.error; s = { session: sign.data.session }; }
        if (!s.session?.user) throw new Error("No session");
        const local = getLocal();
        if (local.length) await supabase.from("watchlist").upsert(local.map((symbol) => ({ user_id:s.session!.user.id, symbol })), { onConflict:"user_id,symbol" });
        const { data: rows, error: qErr } = await supabase.from("watchlist").select("symbol").order("created_at"); if (qErr) throw qErr;
        setWatchlist((rows || []).map((r: { symbol: string }) => r.symbol)); setWatchlistMode("supabase");
      } catch (err) { const msg = err instanceof Error ? err.message : String(err); console.error("[CTI] Supabase watchlist init failed:", err); setSupabaseError(msg); readLocal(); }
    })();
  }, []);

  useEffect(() => {
    const key = "cti-paper-trades-v12";
    const getLocal = () => { try { const p = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(p) ? p as PaperTrade[] : []; } catch { return []; } };
    const readLocal = () => { setPaperTrades(getLocal()); setPaperMode("local"); };
    const mapDbRows = (rows: any[]) => rows.map((r: any) => ({ id:r.id, symbol:r.symbol, base:r.symbol.replace("USDT",""), openedAt:new Date(r.opened_at).getTime(), status:r.status, entry:Number(r.entry), stop:Number(r.stop), tp1:Number(r.tp1), tp2:Number(r.tp2), quantity:Number(r.quantity), capitalIdr:Number(r.capital_idr), riskPct:Number(r.risk_pct), maxLossIdr:Number(r.max_loss_idr), usdtIdr:Number(r.usdt_idr), qualityScore:r.quality_score, opportunityScore:r.opportunity_score, riskScore:r.risk_score, setupStatus:r.setup_status, snapshot:r.snapshot || {}, evaluation:r.evaluation || undefined, closePrice:r.close_price ? Number(r.close_price) : undefined, closedAt:r.closed_at ? new Date(r.closed_at).getTime() : undefined, realizedPnlIdr:r.realized_pnl_idr ? Number(r.realized_pnl_idr) : undefined }));
    (async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { setSupabaseError("Supabase browser config tidak terbaca. Periksa NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY lalu restart Next.js."); return readLocal(); }
      try {
        setSupabaseError("");
        let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session) {
          const signed = await supabase.auth.signInAnonymously();
          if (signed.error) throw signed.error;
          sessionData = { session: signed.data.session };
        }
        const user = sessionData.session?.user;
        if (!user) throw new Error("Anonymous Supabase session tidak tersedia");

        // First prove the authenticated client can read the user's rows. A legacy local migration
        // failure must never force the whole application back to Local browser mode.
        let { data: dbRows, error: readError } = await supabase.from("paper_trades").select("*").order("opened_at", { ascending: false });
        if (readError) throw readError;

        const local = getLocal();
        if ((dbRows || []).length === 0 && local.length) {
          const valid = local.filter((trade) =>
            trade && typeof trade.symbol === "string" && Number.isFinite(Number(trade.openedAt)) &&
            Number.isFinite(Number(trade.entry)) && Number.isFinite(Number(trade.stop)) &&
            Number.isFinite(Number(trade.tp1)) && Number.isFinite(Number(trade.tp2))
          );
          if (valid.length) {
            const migrationRows = valid.map((trade) => ({
              // Use fresh DB ids. Old local ids may already belong to an earlier anonymous user.
              id: crypto.randomUUID(), user_id:user.id, symbol:trade.symbol, opened_at:new Date(trade.openedAt).toISOString(),
              status:trade.status === "CLOSED" ? "CLOSED" : "OPEN", entry:Number(trade.entry), stop:Number(trade.stop),
              tp1:Number(trade.tp1), tp2:Number(trade.tp2), quantity:Number(trade.quantity || 0), capital_idr:Number(trade.capitalIdr || 0),
              risk_pct:Number(trade.riskPct || 0), max_loss_idr:Number(trade.maxLossIdr || 0), usdt_idr:Number(trade.usdtIdr || 0),
              quality_score:Number.isFinite(Number(trade.qualityScore)) ? Number(trade.qualityScore) : 0,
              opportunity_score:Number.isFinite(Number(trade.opportunityScore)) ? Number(trade.opportunityScore) : 0,
              risk_score:Number.isFinite(Number(trade.riskScore)) ? Number(trade.riskScore) : 0,
              setup_status:trade.setupStatus || "WATCH", snapshot:trade.snapshot || {}, evaluation:trade.evaluation || null,
              close_price:trade.closePrice ?? null, closed_at:trade.closedAt ? new Date(trade.closedAt).toISOString() : null,
              realized_pnl_idr:trade.realizedPnlIdr ?? null, updated_at:new Date().toISOString()
            }));
            const { error: migrateError } = await supabase.from("paper_trades").insert(migrationRows);
            if (migrateError) {
              console.warn("[CTI] Legacy paper-trade migration skipped:", migrateError);
              setSupabaseError(`Supabase connected, tetapi migrasi paper trade lokal dilewati: ${migrateError.message}`);
            } else {
              localStorage.removeItem(key);
              const refreshed = await supabase.from("paper_trades").select("*").order("opened_at", { ascending: false });
              if (refreshed.error) throw refreshed.error;
              dbRows = refreshed.data || [];
            }
          }
        }

        setPaperTrades(mapDbRows(dbRows || []));
        setPaperMode("supabase");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CTI] Supabase paper-trade init failed:", err);
        setSupabaseError(msg);
        readLocal();
      }
    })();
  }, []);

  useEffect(() => {
    let stopped = false;
    const loadBackground = async () => { try { const r = await fetch("/api/background-status", { cache:"no-store" }); const j = await r.json(); if (!stopped) setBackground(j); } catch {} };
    loadBackground(); const timer = setInterval(loadBackground, 120_000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  const persistPaper = useCallback(async (trade: PaperTrade) => {
    setPaperTrades((prev) => {
      const next = [trade, ...prev.filter((x) => x.id !== trade.id)].sort((a,b) => b.openedAt-a.openedAt);
      if (paperMode === "local") localStorage.setItem("cti-paper-trades-v12", JSON.stringify(next));
      return next;
    });
    if (paperMode === "local") return;
    const supabase = getSupabaseBrowserClient(); if (!supabase) return; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return;
    const row = { id:trade.id, user_id:auth.user.id, symbol:trade.symbol, opened_at:new Date(trade.openedAt).toISOString(), status:trade.status, entry:trade.entry, stop:trade.stop, tp1:trade.tp1, tp2:trade.tp2, quantity:trade.quantity, capital_idr:trade.capitalIdr, risk_pct:trade.riskPct, max_loss_idr:trade.maxLossIdr, usdt_idr:trade.usdtIdr, quality_score:trade.qualityScore, opportunity_score:trade.opportunityScore, risk_score:trade.riskScore, setup_status:trade.setupStatus, snapshot:trade.snapshot, evaluation:trade.evaluation || null, close_price:trade.closePrice || null, closed_at:trade.closedAt ? new Date(trade.closedAt).toISOString() : null, realized_pnl_idr:trade.realizedPnlIdr ?? null, updated_at:new Date().toISOString() };
    const { error } = await supabase.from("paper_trades").upsert(row); if (error) setMessage(`Paper trade tersimpan lokal di state, tetapi Supabase gagal: ${error.message}`);
  }, [paperMode]);

  const toggleWatchlist = useCallback(async (symbol: string) => { const exists = watchlist.includes(symbol); const next = exists ? watchlist.filter((x) => x !== symbol) : [...watchlist, symbol]; setWatchlist(next); if (watchlistMode === "local") return localStorage.setItem("cti-watchlist-v1", JSON.stringify(next)); const supabase = getSupabaseBrowserClient(); if (!supabase) return; const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return; const result = exists ? await supabase.from("watchlist").delete().eq("user_id", auth.user.id).eq("symbol", symbol) : await supabase.from("watchlist").insert({ user_id: auth.user.id, symbol }); if (result.error) setMessage(result.error.message); }, [watchlist, watchlistMode]);

  const items = useMemo(() => { if (!data) return []; if (filter === "qualified") return data.items.filter((x) => x.setupStatus === "QUALIFIED"); if (filter === "watch") return data.items.filter((x) => x.setupStatus === "WATCH" || x.setupStatus === "WAIT FOR PULLBACK"); if (filter === "lowrisk") return data.items.filter((x) => x.risk < 50); if (filter === "watchlist") return data.items.filter((x) => watchlist.includes(x.symbol)); return data.items; }, [data, filter, watchlist]);
  const effectiveRate = autoIdr && idrData?.usdtIdr ? idrData.usdtIdr : parseIdr(usdtIdr, 16_500);
  const displayIdr = useCallback((base: string, usdtPrice: number) => idrData?.prices?.[base]?.idr ?? usdtPrice * effectiveRate, [idrData, effectiveRate]);
  const position = useMemo(() => { if (!selected) return null; const capital = parseIdr(capitalIdr, 10_000_000); const rp = Math.min(10, Math.max(.1, Number(riskPct.replace(",", ".")) || 1)); const rate = effectiveRate; const entry = selected.levels.entryHigh; const perCoin = Math.max(.00000001, entry - selected.levels.stop); const maxLossIdr = capital * rp / 100; const qty = (maxLossIdr / rate) / perCoin; const notionalIdr = qty * entry * rate; return { capital, rp, rate, maxLossIdr, qty, notionalIdr, allocation: notionalIdr / capital * 100 }; }, [selected, capitalIdr, riskPct, effectiveRate]);

  const openPaperTrade = useCallback(() => { if (!selected || !position) return; const trade: PaperTrade = { id: crypto.randomUUID(), symbol:selected.symbol, base:selected.base, openedAt:Date.now(), status:"OPEN", entry:selected.levels.entryHigh, stop:selected.levels.stop, tp1:selected.levels.tp1, tp2:selected.levels.tp2, quantity:position.qty, capitalIdr:position.capital, riskPct:position.rp, maxLossIdr:position.maxLossIdr, usdtIdr:position.rate, qualityScore:selected.qualityScore, opportunityScore:selected.score, riskScore:selected.risk, setupStatus:selected.setupStatus, snapshot:{rsi4h:selected.rsi4h, volumeRatio4h:selected.volumeRatio4h, trend1d:selected.trend1d, trend4h:selected.trend4h, change24h:selected.change24h} }; persistPaper(trade); setMessage(`Paper trade ${selected.base} dibuat. Tidak ada order real yang dikirim.`); setView("trades"); }, [selected, position, persistPaper]);

  const evaluateTrade = useCallback(async (trade: PaperTrade) => { setEvaluating(trade.id); try { const qs = new URLSearchParams({ symbol:trade.symbol, openedAt:String(trade.openedAt), entry:String(trade.entry), stop:String(trade.stop), tp1:String(trade.tp1), tp2:String(trade.tp2) }); const r = await fetch(`/api/paper-evaluate?${qs.toString()}`, { cache:"no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Evaluation failed"); await persistPaper({ ...trade, evaluation:j }); } catch(e) { setMessage(e instanceof Error ? e.message : "Evaluation failed"); } finally { setEvaluating(null); } }, [persistPaper]);

  const validateDueTrades = useCallback(async () => {
    const due = paperTrades.filter((t) => ageHours(t.openedAt) >= 4 && (!t.evaluation?.evaluatedAt || Date.now() - new Date(t.evaluation.evaluatedAt).getTime() > 30 * 60_000)).slice(0, 8);
    if (!due.length) return;
    setAutoValidating(true);
    for (const trade of due) {
      try {
        const qs = new URLSearchParams({ symbol:trade.symbol, openedAt:String(trade.openedAt), entry:String(trade.entry), stop:String(trade.stop), tp1:String(trade.tp1), tp2:String(trade.tp2) });
        const r = await fetch(`/api/paper-evaluate?${qs.toString()}`, { cache:"no-store" });
        const j = await r.json();
        if (r.ok) await persistPaper({ ...trade, evaluation:j });
      } catch {}
    }
    setAutoValidating(false);
  }, [paperTrades, persistPaper]);

  useEffect(() => {
    if (autoValidationStarted.current || !paperTrades.length) return;
    autoValidationStarted.current = true;
    validateDueTrades();
  }, [paperTrades.length, validateDueTrades]);

  const closeTrade = useCallback(async (trade: PaperTrade) => { const px = data?.items.find((x) => x.symbol === trade.symbol)?.price; if (!px) return setMessage(`${trade.base} tidak ada di current scanner universe; refresh scanner dahulu.`); const pnlUsdt = (px - trade.entry) * trade.quantity; const closed = { ...trade, status:"CLOSED" as const, closePrice:px, closedAt:Date.now(), realizedPnlIdr:pnlUsdt*trade.usdtIdr }; await persistPaper(closed); }, [data, persistPaper]);


  const exportTradesCsv = useCallback(() => {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"','""')}"`;
    const header = ["id","symbol","opened_at","status","setup_status","quality","opportunity","risk","entry_usdt","stop_usdt","tp1_usdt","tp2_usdt","usdt_idr","quantity","outcome","4h_return_pct","12h_return_pct","24h_return_pct","3d_return_pct","7d_return_pct","realized_pnl_idr"];
    const rows = paperTrades.map((t) => { const c=t.evaluation?.checkpoints; return [t.id,t.symbol,new Date(t.openedAt).toISOString(),t.status,t.setupStatus,t.qualityScore,t.opportunityScore,t.riskScore,t.entry,t.stop,t.tp1,t.tp2,t.usdtIdr,t.quantity,t.evaluation?.outcome||"",c?.["4h"]?.returnPct??"",c?.["12h"]?.returnPct??"",c?.["24h"]?.returnPct??"",c?.["3d"]?.returnPct??"",c?.["7d"]?.returnPct??"",t.realizedPnlIdr??""].map(esc).join(","); });
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8" }); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`cti-paper-trades-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [paperTrades]);

  const performance = useMemo(() => { const vals = paperTrades.map((t) => rValue(t.evaluation?.outcome)).filter((x): x is number => x != null); const wins = vals.filter((x) => x > 0); const losses = vals.filter((x) => x < 0); const sumPos = wins.reduce((a,b)=>a+b,0); const sumNeg = Math.abs(losses.reduce((a,b)=>a+b,0)); let equity=0, peak=0, maxDd=0; for(const r of vals.slice().reverse()){equity+=r; peak=Math.max(peak,equity); maxDd=Math.max(maxDd,peak-equity);} return { evaluated:vals.length, winRate:vals.length?wins.length/vals.length*100:0, expectancy:vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0, profitFactor:sumNeg?sumPos/sumNeg:(sumPos?999:0), maxDd, open:paperTrades.filter(t=>t.status==="OPEN").length, realizedPnl:paperTrades.reduce((s,t)=>s+(t.realizedPnlIdr||0),0) }; }, [paperTrades]);

  const calibration = useMemo(() => ({
    quality: bucketStats(paperTrades, (t) => t.qualityScore >= 80 ? "80–100" : t.qualityScore >= 70 ? "70–79" : t.qualityScore >= 60 ? "60–69" : "<60", ["80–100","70–79","60–69","<60"]),
    rsi: bucketStats(paperTrades, (t) => { const v=t.snapshot.rsi4h ?? 0; return v > 75 ? ">75" : v >= 69 ? "69–75" : v >= 55 ? "55–68" : "<55"; }, ["55–68","69–75",">75","<55"]),
    volume: bucketStats(paperTrades, (t) => { const v=t.snapshot.volumeRatio4h ?? 0; return v >= 1.2 ? ">=1.20x" : v >= .9 ? "0.90–1.19x" : v >= .6 ? "0.60–0.89x" : "<0.60x"; }, [">=1.20x","0.90–1.19x","0.60–0.89x","<0.60x"]),
    risk: bucketStats(paperTrades, (t) => t.riskScore < 40 ? "<40" : t.riskScore < 60 ? "40–59" : t.riskScore < 70 ? "60–69" : ">=70", ["<40","40–59","60–69",">=70"]),
  }), [paperTrades]);

  const checkpointSummary = useMemo(() => (["4h","12h","24h","3d","7d"] as const).map((key) => {
    const values = paperTrades.map((t) => t.evaluation?.checkpoints?.[key]?.returnPct).filter((v): v is number => v != null);
    const positive = values.filter((v) => v > 0).length;
    return { key, sample: values.length, avg: values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0, positive: values.length ? positive/values.length*100 : 0 };
  }), [paperTrades]);

  const topQualified = data?.items.find((x) => x.setupStatus === "QUALIFIED"); const selectedInWatchlist = selected ? watchlist.includes(selected.symbol) : false;

  return <div className="shell"><header className="header"><div className="header-inner header-row"><div className="brand"><div className="logo">CT</div><div><h1>Crypto Trading Intelligence</h1><small>V1.4.2 · persistent data + migration diagnostics</small></div></div><div className="live">{["BTCUSDT","ETHUSDT","SOLUSDT"].map((s)=><div className="live-pill" key={s}>{s.replace("USDT","")} <b>{live[s]?fmtIdrPrice(live[s].price * effectiveRate):"connecting…"}</b>{live[s]&&<span className={live[s].change>=0?"up":"down"}> {live[s].change>=0?"+":""}{live[s].change.toFixed(2)}%</span>}</div>)}</div></div></header>
  <main className="main"><div className="notice"><b>Paper trading only.</b> V1.4 tidak mengirim order ke exchange. Dengan Supabase + GitHub Actions, validator dan 4H scanner snapshot dapat berjalan tanpa browser terbuka.</div>{error&&<div className="error">{error}</div>}{message&&<div className="info">{message}</div>}
  <div className="info">Harga IDR: <b>{autoIdr && idrData?.usdtIdr ? `CoinGecko · 1 USDT ≈ Rp${Math.round(effectiveRate).toLocaleString("id-ID")}` : `manual · 1 USDT = Rp${Math.round(effectiveRate).toLocaleString("id-ID")}`}</b>. Technical analysis tetap memakai OHLCV Binance USDT agar indikator konsisten. {idrLoading ? "Memperbarui harga IDR…" : idrError ? `CoinGecko fallback aktif: ${idrError}` : ""}</div><div className="info"><Database size={14}/> Data mode: <b>{paperMode === "supabase" ? "Supabase persistent" : "Local browser"}</b> · Background: <b>{background?.configured ? "server configured" : "not configured"}</b>{background?.jobs?.validate?.finished_at ? ` · Validator terakhir ${new Date(background.jobs.validate.finished_at).toLocaleString("id-ID")} (${background.jobs.validate.status}, ${background.jobs.validate.processed} trade)` : ""}{background?.jobs?.snapshot?.finished_at ? ` · Snapshot terakhir ${new Date(background.jobs.snapshot.finished_at).toLocaleString("id-ID")}` : ""}</div>{supabaseError&&<div className="error">Supabase client: {supabaseError}</div>}<div className="top-nav"><button className={`btn ${view==="scanner"?"active":""}`} onClick={()=>setView("scanner")}><TrendingUp size={14}/> Scanner</button><button className={`btn ${view==="trades"?"active":""}`} onClick={()=>setView("trades")}><FlaskConical size={14}/> Paper Trades ({paperTrades.length})</button><button className={`btn ${view==="performance"?"active":""}`} onClick={()=>setView("performance")}><BarChart3 size={14}/> Performance</button></div>

  {data&&view==="scanner"&&<><div className="grid-4"><div className="card"><div className="metric-label"><Activity size={13}/> Market Quality</div><div className="metric">{data.market.score}/100</div><div className="metric-sub"><span className={`badge ${badgeClass(data.market.regime)}`}>{data.market.regime}</span></div></div><div className="card"><div className="metric-label"><TrendingUp size={13}/> Entry Environment</div><div className="metric metric-small">{data.market.entryEnvironment}</div><div className="metric-sub">Qualified: {data.market.qualifiedCount} / {data.market.scanned}</div></div><div className="card"><div className="metric-label">Bullish Universe</div><div className="metric">{data.market.bullishCount}/{data.market.scanned}</div><div className="metric-sub">BTC trend: {data.market.btcTrend}</div></div><div className="card"><div className="metric-label"><ShieldAlert size={13}/> Qualified Setup</div><div className="metric metric-small">{topQualified?.base||"None"}</div><div className="metric-sub">{topQualified?`Quality ${topQualified.qualityScore} · Risk ${topQualified.riskLabel}`:"Gate belum terpenuhi"}</div></div></div>
  <section className="section"><div className="section-head"><div><h2>Opportunity Scanner</h2><p>V1.4 mempertahankan ruleset V1.3 dan menambahkan persistence, background validation, serta 4H historical snapshots.</p></div><div className="actions"><button className={`btn ${filter==="all"?"active":""}`} onClick={()=>setFilter("all")}>All</button><button className={`btn ${filter==="qualified"?"active":""}`} onClick={()=>setFilter("qualified")}>Qualified</button><button className={`btn ${filter==="watch"?"active":""}`} onClick={()=>setFilter("watch")}>Watch / Pullback</button><button className={`btn ${filter==="lowrisk"?"active":""}`} onClick={()=>setFilter("lowrisk")}>Lower Risk</button><button className={`btn ${filter==="watchlist"?"active":""}`} onClick={()=>setFilter("watchlist")}><Bookmark size={14}/> Watchlist ({watchlist.length})</button><button className="btn" onClick={load} disabled={loading}><RefreshCw size={14}/>{loading?"Scanning…":"Refresh"}</button></div></div>
  <div className="table-wrap"><table><thead><tr><th></th><th>Asset</th><th>Status</th><th>Price (IDR)</th><th>24H</th><th>Quality</th><th>Opp.</th><th>1D</th><th>4H</th><th>RSI 4H</th><th>Rel. Vol</th><th>Risk</th></tr></thead><tbody>{items.map((x)=><tr key={x.symbol} className={selected?.symbol===x.symbol?"selected-row":""} onClick={()=>setSelected(x)}><td><button className="icon-btn" onClick={(e)=>{e.stopPropagation();toggleWatchlist(x.symbol)}}>{watchlist.includes(x.symbol)?<BookmarkCheck size={16}/>:<Bookmark size={16}/>}</button></td><td><div className="coin"><div className="coin-icon">{x.base.slice(0,3)}</div>{x.base}/USDT</div></td><td><span className={`badge ${badgeClass(x.setupStatus)}`}>{x.setupStatus}</span></td><td>{fmtIdrPrice(displayIdr(x.base, x.price))}</td><td className={x.change24h>=0?"up":"down"}>{x.change24h>=0?"+":""}{x.change24h.toFixed(2)}%</td><td><div className="score">{x.qualityScore}</div><div className="bar"><span style={{width:`${x.qualityScore}%`}}/></div></td><td className="score secondary">{x.score}</td><td><span className={`badge ${badgeClass(x.trend1d)}`}>{x.trend1d}</span></td><td><span className={`badge ${badgeClass(x.trend4h)}`}>{x.trend4h}</span></td><td>{x.rsi4h?.toFixed(1)||"-"}</td><td className={(x.volumeRatio4h||0)>=.9?"up":(x.volumeRatio4h||0)<.6?"down":""}>{x.volumeRatio4h?`${x.volumeRatio4h.toFixed(2)}x`:"-"}</td><td><span className={`badge ${badgeClass(x.riskLabel)}`}>{x.riskLabel} · {x.risk}</span></td></tr>)}{!items.length&&<tr><td colSpan={12} className="empty">Tidak ada aset pada filter ini.</td></tr>}</tbody></table></div><p className="methodology">{data.methodology}</p></section>

  {selected&&<section className="section"><div className="section-head"><div><h2>{selected.base} Setup Review</h2><p>Status utama: <span className={`badge ${badgeClass(selected.setupStatus)}`}>{selected.setupStatus}</span></p></div><div className="actions"><button className="btn" onClick={()=>toggleWatchlist(selected.symbol)}>{selectedInWatchlist?<BookmarkCheck size={14}/>:<Bookmark size={14}/>} {selectedInWatchlist?"In Watchlist":"Add Watchlist"}</button></div></div>
  <div className="detail-top"><div className="card analysis-box"><div className="score-row"><div><span className="eyebrow">Quality</span><strong>{selected.qualityScore}</strong></div><div><span className="eyebrow">Opportunity</span><strong>{selected.score}</strong></div><div><span className="eyebrow">Risk</span><strong>{selected.risk}</strong></div></div><ul className="reasons">{selected.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul></div><div className="card"><div className="kv"><div><span>Entry zone</span><b>{fmtIdrPrice(selected.levels.entryLow * effectiveRate)} – {fmtIdrPrice(selected.levels.entryHigh * effectiveRate)}</b></div><div><span>Stop</span><b>{fmtIdrPrice(selected.levels.stop * effectiveRate)}</b></div><div><span>TP1</span><b>{fmtIdrPrice(selected.levels.tp1 * effectiveRate)}</b></div><div><span>TP2</span><b>{fmtIdrPrice(selected.levels.tp2 * effectiveRate)}</b></div><div><span>Rel. Vol</span><b>{selected.volumeRatio4h?.toFixed(2)||"-"}x</b></div><div><span>RSI 4H</span><b>{selected.rsi4h?.toFixed(1)||"-"}</b></div></div></div></div>
  <div className="tf-grid">{detailLoading?<div className="card loading">Loading 1H/4H/1D…</div>:detail&&(["1d","4h","1h"] as const).map((k)=>{const tf=detail.timeframes[k];return <div className="card timeframe-card" key={k}><div className="tf-head"><h3>{tf.interval}</h3><span className={`badge ${badgeClass(tf.trend)}`}>{tf.trend}</span></div><div className="tf-score">{tf.score}/100</div><div className="mini-kv"><span>RSI<b>{tf.rsi14?.toFixed(1)||"-"}</b></span><span>Rel. Vol<b>{tf.volumeRatio?.toFixed(2)||"-"}x</b></span><span>ATR<b>{tf.atrPct?.toFixed(2)||"-"}%</b></span><span>MACD Hist<b>{tf.macdHistogram?.toPrecision(3)||"-"}</b></span><span>Support<b>{fmtIdrPrice(tf.support * effectiveRate)}</b></span><span>Resistance<b>{fmtIdrPrice(tf.resistance * effectiveRate)}</b></span></div></div>})}</div>
  <div className="card position-card"><div className="position-head"><h3>Position Size + Paper Trade</h3><p>Paper trade menggunakan entry/stop/TP model 4H dan ukuran posisi berdasarkan max loss.</p></div><div className="input-grid"><label>Modal (IDR)<input value={capitalIdr} onChange={(e)=>setCapitalIdr(e.target.value)}/></label><label>Risk / trade (%)<input value={riskPct} onChange={(e)=>setRiskPct(e.target.value)}/></label><label>1 USDT = IDR <small>{autoIdr?"(CoinGecko auto)":"(manual fallback)"}</small><input value={usdtIdr} onChange={(e)=>setUsdtIdr(e.target.value)} disabled={autoIdr}/><span className="subline"><input type="checkbox" checked={autoIdr} onChange={(e)=>setAutoIdr(e.target.checked)}/> Auto IDR rate</span></label></div>{position&&<div className="position-results"><div><span>Max loss</span><strong>{fmtIdr(position.maxLossIdr)}</strong></div><div><span>Max qty</span><strong>{position.qty.toFixed(position.qty>=1?4:6)} {selected.base}</strong></div><div><span>Position</span><strong>{fmtIdr(position.notionalIdr)}</strong></div><div><span>Allocation</span><strong>{position.allocation.toFixed(1)}%</strong></div></div>}<div className="paper-action"><button className="btn primary" onClick={openPaperTrade}><PlayCircle size={15}/> Create Paper Trade</button><span>Ini hanya mencatat simulasi; tidak ada API trading/private key.</span></div></div></section>}</>}

  {view==="trades"&&<section className="section"><div className="section-head"><div><h2>Paper Trading Journal</h2><p>Checkpoint 4H / 12H / 24H / 3D / 7D menggunakan closed 1H candles. Trade yang sudah ≥4H divalidasi saat app dibuka; jika background scheduler aktif, validasi juga berjalan periodik tanpa browser.</p></div><div className="actions"><button className="btn" onClick={exportTradesCsv} disabled={!paperTrades.length}><Download size={14}/> Export CSV</button><button className="btn" onClick={validateDueTrades} disabled={autoValidating}><History size={14}/>{autoValidating?"Validating…":"Validate due trades"}</button><button className="btn" onClick={load}><RefreshCw size={14}/> Refresh market</button></div></div><div className="table-wrap"><table className="trade-table validation-table"><thead><tr><th>Opened</th><th>Asset</th><th>Setup</th><th>Entry (IDR)</th><th>Validation</th><th>4H</th><th>12H</th><th>24H</th><th>3D</th><th>7D</th><th>MTM</th><th>Actions</th></tr></thead><tbody>{paperTrades.map((t)=>{const current=data?.items.find(x=>x.symbol===t.symbol)?.price;const mtm=current?((current-t.entry)*t.quantity*t.usdtIdr):null;const cp=t.evaluation?.checkpoints;const checkpointCell=(k:"4h"|"12h"|"24h"|"3d"|"7d")=>{const c=cp?.[k];return !c?.reached?<span className="muted-cell">pending</span>:<span className={(c.returnPct||0)>=0?"up":"down"}>{(c.returnPct||0)>=0?"+":""}{c.returnPct?.toFixed(2)}%</span>};return <tr key={t.id}><td>{new Date(t.openedAt).toLocaleString("id-ID")}<small className="subline">Age {ageHours(t.openedAt).toFixed(1)}h</small></td><td><b>{t.base}/USDT</b><small className="subline">Q {t.qualityScore} · O {t.opportunityScore} · R {t.riskScore}</small></td><td><span className={`badge ${badgeClass(t.setupStatus)}`}>{t.setupStatus}</span></td><td>{fmtIdrPrice(t.entry * t.usdtIdr)}<small className="subline">SL {fmtIdrPrice(t.stop*t.usdtIdr)}</small></td><td><span className={`badge ${badgeClass(t.evaluation?.outcome||"OPEN")}`}>{t.evaluation?.outcome||"NOT EVALUATED"}</span>{t.evaluation&&<small className="subline">{t.evaluation.candlesChecked} closed 1H</small>}</td><td>{checkpointCell("4h")}</td><td>{checkpointCell("12h")}</td><td>{checkpointCell("24h")}</td><td>{checkpointCell("3d")}</td><td>{checkpointCell("7d")}</td><td className={mtm!=null&&mtm>=0?"up":"down"}>{t.status==="CLOSED"?fmtIdr(t.realizedPnlIdr||0):mtm==null?"-":fmtIdr(mtm)}</td><td><div className="row-actions"><button className="btn compact" onClick={()=>evaluateTrade(t)} disabled={evaluating===t.id}><History size={13}/>{evaluating===t.id?"Checking…":"Evaluate"}</button>{t.status==="OPEN"&&<button className="btn compact" onClick={()=>closeTrade(t)}><XCircle size={13}/> Close</button>}</div></td></tr>})}{!paperTrades.length&&<tr><td colSpan={12} className="empty">Belum ada paper trade. Pilih setup di Scanner lalu klik Create Paper Trade.</td></tr>}</tbody></table></div><p className="methodology">Return checkpoint dihitung dari entry ke close candle pada horizon terkait. MFE/MAE disimpan di evaluation JSON. Jika stop dan TP disentuh dalam candle 1H yang sama sebelum urutan dapat diketahui, outcome tetap AMBIGUOUS agar statistik tidak terlalu optimistis.</p></section>}

  {view==="performance"&&<section className="section"><div className="section-head"><div><h2>Validation & Calibration</h2><p>Gunakan data ini untuk menguji ruleset, bukan untuk mengubah bobot setelah sampel yang sangat kecil.</p></div><div className="actions"><button className="btn" onClick={validateDueTrades} disabled={autoValidating}><History size={14}/>{autoValidating?"Validating…":"Refresh validation"}</button></div></div><div className="grid-4"><div className="card"><div className="metric-label">Evaluated Setups</div><div className="metric">{performance.evaluated}</div><div className="metric-sub">Open paper trades: {performance.open}</div></div><div className="card"><div className="metric-label">Win Rate</div><div className="metric">{performance.winRate.toFixed(1)}%</div><div className="metric-sub">TP1/TP2 vs Stop; ambiguous excluded</div></div><div className="card"><div className="metric-label">Expectancy</div><div className="metric">{performance.expectancy>=0?"+":""}{performance.expectancy.toFixed(2)}R</div><div className="metric-sub">TP1=+1.5R · TP2=+2.5R · Stop=-1R</div></div><div className="card"><div className="metric-label">Profit Factor</div><div className="metric">{performance.profitFactor>=999?"∞":performance.profitFactor.toFixed(2)}</div><div className="metric-sub">Validation max drawdown: {performance.maxDd.toFixed(2)}R</div></div></div><div className="checkpoint-grid">{checkpointSummary.map((c)=><div className="card checkpoint-card" key={c.key}><span className="eyebrow">{c.key.toUpperCase()} Checkpoint</span><strong className={c.avg>=0?"up":"down"}>{c.avg>=0?"+":""}{c.avg.toFixed(2)}%</strong><small>{c.sample} sample · {c.positive.toFixed(0)}% positive</small></div>)}</div><div className="calibration-grid">{([{title:"Quality Score",rows:calibration.quality},{title:"RSI 4H",rows:calibration.rsi},{title:"Relative Volume",rows:calibration.volume},{title:"Risk Score",rows:calibration.risk}] as const).map((group)=><div className="card calibration-card" key={group.title}><h3>{group.title}</h3><table className="mini-table"><thead><tr><th>Bucket</th><th>N</th><th>Win</th><th>Avg R</th></tr></thead><tbody>{group.rows.map((r)=><tr key={r.label}><td>{r.label}</td><td>{r.sample}</td><td>{r.sample?r.winRate.toFixed(0)+"%":"-"}</td><td className={r.avgR>=0?"up":"down"}>{r.sample?(r.avgR>=0?"+":"")+r.avgR.toFixed(2):"-"}</td></tr>)}</tbody></table></div>)}</div><div className="card performance-note"><h3>How to read calibration</h3><p>Bucket dengan hasil terbaik belum otomatis berarti parameter tersebut predictive. Tunggu sampel yang cukup dan beberapa kondisi market. Sebagai rule praktis, jangan kalibrasi bobot hanya dari 5–10 setup; mulai evaluasi lebih serius setelah puluhan observasi per kelompok bila memungkinkan.</p><div className="performance-strip"><span>Manual realized P/L <b className={performance.realizedPnl>=0?"up":"down"}>{fmtIdr(performance.realizedPnl)}</b></span><span>Storage <b>{paperMode==="supabase"?"Supabase":"Local browser"}</b></span><span>Auto validator <b>{background?.configured?"background-ready":"app-open only"}</b></span></div></div></section>}

  {loading&&!data&&<div className="loading">Mengambil market data dan menghitung indikator…</div>}<div className="footer">V1.4.2 · IDR display source: {autoIdr && idrData?.usdtIdr ? "CoinGecko" : "manual fallback"} · TA source: Binance USDT closed candles · IDR refresh: ~60s in browser · Paper trading storage: {paperMode==="supabase"?"Supabase":"Local browser"} · Background: {background?.configured?"configured":"off"} · No exchange order execution.</div></main></div>;
}
