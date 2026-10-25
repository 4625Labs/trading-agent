/**
 * Live shadow control group. Two practice-only policies ('equal' fixed weights, 'learned' weights from shadow_weights) decide on the
 * SAME live signals and prices each cycle. Nothing here touches the exchange, Omnara, or an LLM.
 */
import { Simulator } from "./simulator.ts";
import type { SimPosition } from "./simulator.ts";
import { weightedVote, updateSourceWeights } from "./learning/weights.ts";
import { sourceStats } from "./learning/stats.ts";
import type { ClosedTrade } from "./learning/types.ts";
import { parseKlines } from "./learning/replay.ts";
import type { Candle } from "./learning/replay.ts";
import { technicalSignals } from "./replay/sources.ts";
import { recordUsage } from "./usage.ts";

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export type Policy = "learned" | "equal";
export const POLICIES: Policy[] = ["equal", "learned"];
export const SHADOW = { threshold: 0.3, sizeUsd: 50, stopPct: 0.02, targetPct: 0.04, maxHoldHours: 12, cooldownHours: 4, slippageBps: 5, feeBps: 10, assets: ["BTC", "ETH", "SOL"] };

export interface VoteSignal { asset: string; source: string; direction: "long" | "short"; confidence: number }

// ---------- live candles (5 min cache) ----------
const candleCache = new Map<string, { at: number; cs: Candle[] }>();
export async function liveCandles(asset: string, nowMs = Date.now()): Promise<Candle[]> {
  const hit = candleCache.get(asset);
  if (hit && nowMs - hit.at < 5 * 60_000) return hit.cs;
  let res: Response;
  try { res = await fetch(`https://api.binance.us/api/v3/klines?symbol=${asset.toUpperCase()}USDT&interval=4h&limit=120`); }
  catch (e) { recordUsage({ provider: "binance", endpoint: "klines", status: null, detail: { asset } }); throw new Error(`klines request failed: ${(e as Error).name}`); }
  recordUsage({ provider: "binance", endpoint: "klines", status: res.status, detail: { asset, interval: "4h" } });
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const cs = parseKlines((await res.json()) as unknown[][]);
  candleCache.set(asset, { at: nowMs, cs });
  return cs;
}

// ---------- pure decision ----------
export interface Decision { direction: "long" | "short"; vote: number; votes: Record<string, number> }

/** Weighted vote (same semantics as the learner's weightedVote). Returns null below the threshold. */
export function decide(signals: VoteSignal[], weights: Record<string, number>, threshold = SHADOW.threshold): Decision | null {
  if (!signals.length) return null;
  const v = weightedVote(signals.map((s) => ({ sourceId: s.source, direction: s.direction, confidence: s.confidence })), weights);
  if (Math.abs(v) < threshold) return null;
  const votes: Record<string, number> = {};
  for (const s of signals) votes[s.source] = (votes[s.source] ?? 0) + (weights[s.source] ?? 1) * s.confidence * (s.direction === "long" ? 1 : -1);
  for (const k of Object.keys(votes)) votes[k] = +votes[k].toFixed(4);
  return { direction: v >= 0 ? "long" : "short", vote: v, votes };
}

// ---------- weights ----------
export async function loadShadowWeights(pool: Queryable): Promise<Record<string, number>> {
  return Object.fromEntries((await pool.query("select source, weight from shadow_weights")).rows.map((r) => [r.source, +r.weight]));
}

/** First run only: seed from the latest finished rolling run's summary.warmStartWeights. Existing rows are never overwritten. */
export async function seedWarmStart(pool: Queryable): Promise<number> {
  if (+(await pool.query("select count(*)::int c from shadow_weights")).rows[0].c > 0) return 0;
  const r = await pool.query("select summary from rolling_runs where status='done' order by finished_at desc nulls last, started_at desc limit 1");
  const ws = r.rows[0]?.summary?.warmStartWeights;
  if (!ws || typeof ws !== "object") return 0;
  let n = 0;
  for (const [k, w] of Object.entries(ws as Record<string, unknown>)) {
    const weight = Number(w);
    if (!Number.isFinite(weight)) continue;
    const keys = [k];
    if (["momentum", "meanrev", "breakout", "volregime"].includes(k)) keys.push(`technical:${k}`);
    for (const key of keys) n += (await pool.query("insert into shadow_weights(source,weight) values ($1,$2) on conflict (source) do nothing", [key, Math.min(3, Math.max(0.05, weight))])).rowCount ?? 0;
  }
  return n;
}

// ---------- cycle ----------
export interface ShadowDeps {
  pool: Queryable;
  price: (asset: string) => Promise<number>;
  candles?: (asset: string) => Promise<Candle[]>;
  /** override the news-signal source (tests); default reads signals from the last 24h */
  newsSignals?: () => Promise<VoteSignal[]>;
  now?: () => Date;
  log?: (m: string) => void;
  cycleId?: string | null;
  assets?: string[];
  threshold?: number;
  sizeUsd?: number;
  cooldownHours?: number;
}

async function readNews(pool: Queryable): Promise<VoteSignal[]> {
  const r = await pool.query("select asset, direction, confidence, coalesce(source_name,'unknown') source_name from signals where created_at > now() - interval '24 hours'");
  return r.rows.map((x) => ({ asset: x.asset, source: String(x.source_name), direction: x.direction, confidence: +x.confidence }));
}

export async function runShadowCycle(deps: ShadowDeps): Promise<{ opened: { learned: number; equal: number }; notes: string }> {
  const log = deps.log ?? (() => {});
  const now = (deps.now ?? (() => new Date()))();
  const assets = deps.assets ?? SHADOW.assets;
  const notes: string[] = [];
  const opened = { learned: 0, equal: 0 };
  const seeded = await seedWarmStart(deps.pool);
  if (seeded) notes.push(`warm start: seeded ${seeded} weights`);
  const weights = await loadShadowWeights(deps.pool);
  let news: VoteSignal[] = [];
  try { news = await (deps.newsSignals ?? (() => readNews(deps.pool)))(); } catch (e) { notes.push(`news read failed: ${(e as Error).message}`); }
  const getCandles = deps.candles ?? ((a: string) => liveCandles(a, now.getTime()));
  for (const asset of assets) {
    let mid: number;
    try { mid = await deps.price(asset); } catch (e) { notes.push(`price ${asset} failed`); continue; }
    if (!(mid > 0)) continue;
    const sigs: VoteSignal[] = news.filter((s) => s.asset === asset);
    try {
      const cs = await getCandles(asset);
      for (const s of technicalSignals(cs, cs.length - 1, asset)) sigs.push({ asset, source: `technical:${s.source}`, direction: s.direction, confidence: s.confidence });
    } catch (e) { notes.push(`candles ${asset} failed`); }
    for (const policy of POLICIES) {
      const busy = await deps.pool.query(
        "select 1 from shadow_trades where policy=$1 and asset=$2 and (status='open' or opened_at > $3::timestamptz - make_interval(hours => $4::int)) limit 1",
        [policy, asset, now, deps.cooldownHours ?? SHADOW.cooldownHours],
      );
      if (busy.rowCount) continue;
      const d = decide(sigs, policy === "learned" ? weights : {}, deps.threshold ?? SHADOW.threshold);
      if (!d) continue;
      const size = deps.sizeUsd ?? SHADOW.sizeUsd;
      const sim = new Simulator(async () => mid, { slippageBps: SHADOW.slippageBps, feeBps: SHADOW.feeBps }, () => now);
      const fill = await sim.placeOrder({ id: "shadow", asset, direction: d.direction, entry: mid, size, stop: 0, target: 0, rationale: "", confidence: 0, signalIds: [] });
      const long = d.direction === "long";
      const stop = mid * (long ? 1 - SHADOW.stopPct : 1 + SHADOW.stopPct), target = mid * (long ? 1 + SHADOW.targetPct : 1 - SHADOW.targetPct);
      await deps.pool.query(
        "insert into shadow_trades(cycle_id,policy,asset,direction,size,entry,stop,target,opened_at,votes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [deps.cycleId ?? null, policy, asset, d.direction, size, fill.fillPrice, stop, target, now, JSON.stringify(d.votes)],
      );
      opened[policy]++;
    }
  }
  log(`shadow: opened ${JSON.stringify(opened)}${notes.length ? ` (${notes.join("; ")})` : ""}`);
  return { opened, notes: notes.join("; ") };
}

// ---------- outcomes ----------
export interface ShadowOutcomeDeps { pool: Queryable; price: (asset: string) => Promise<number>; now?: () => Date; log?: (m: string) => void }

/** Close open shadow positions on stop / target / 12h timeout; learned-policy closes update shadow_weights. Safe to call every minute. */
export async function updateShadowOutcomes(deps: ShadowOutcomeDeps): Promise<{ checked: number; closed: number; weightsUpdated: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const open = (await deps.pool.query("select id,policy,asset,direction,size,entry,stop,target,opened_at,votes from shadow_trades where status='open'")).rows;
  const prices = new Map<string, number | null>();
  for (const a of new Set(open.map((o) => o.asset as string))) prices.set(a, await deps.price(a).catch(() => null));
  const learnedClosed: ClosedTrade[] = [];
  let closed = 0;
  for (const o of open) {
    const px = prices.get(o.asset);
    if (!px || !(px > 0)) continue;
    const long = o.direction === "long";
    const [entry, stop, target, size] = [+o.entry, +o.stop, +o.target, +o.size];
    const hitStop = long ? px <= stop : px >= stop, hitTarget = long ? px >= target : px <= target;
    const timedOut = now.getTime() - new Date(o.opened_at).getTime() >= SHADOW.maxHoldHours * 3600_000;
    if (!hitStop && !hitTarget && !timedOut) continue;
    const reason = hitStop ? "stop" : hitTarget ? "target" : "timeout";
    const sim = new Simulator(async () => px, { slippageBps: SHADOW.slippageBps, feeBps: SHADOW.feeBps }, () => now);
    const pos: SimPosition = { thesis: { id: o.id, asset: o.asset, direction: o.direction, entry, size, stop, target, rationale: "", confidence: 0, signalIds: [] }, fillPrice: entry, qty: size / entry, entryFee: size * (SHADOW.feeBps / 1e4), status: "open" };
    sim.close(pos, px, reason === "timeout" ? "manual" : reason);
    // atomic claim + write: only one caller can move the row from open to closed
    const claim = await deps.pool.query(
      "update shadow_trades set status='closed', closed_at=$2, exit_price=$3, exit_reason=$4, pnl=$5 where id=$1 and status='open' returning id",
      [o.id, now, pos.exitPrice, reason, +pos.pnl!.toFixed(4)],
    );
    if (!claim.rowCount) continue;
    closed++;
    if (o.policy === "learned") {
      const votes = (o.votes ?? {}) as Record<string, number>;
      learnedClosed.push({ thesisId: o.id, asset: o.asset, direction: o.direction, confidence: 0, pnl: pos.pnl!, signals: Object.entries(votes).map(([sourceId, c]) => ({ sourceId, direction: c >= 0 ? "long" : "short", confidence: Math.abs(c) })) });
    }
  }
  let weightsUpdated = 0;
  if (learnedClosed.length) {
    const batch = sourceStats(learnedClosed);
    const ids = Object.keys(batch);
    if (ids.length) {
      const rows = (await deps.pool.query("select source, weight, hits, trials from shadow_weights where source = any($1::text[])", [ids])).rows;
      const prevW: Record<string, number> = {}, cum: Record<string, any> = {};
      for (const r of rows) { prevW[r.source] = +r.weight; }
      for (const id of ids) {
        const old = rows.find((r) => r.source === id);
        const hits = (old?.hits ?? 0) + batch[id].hits, trials = (old?.trials ?? 0) + batch[id].trials;
        cum[id] = { ...batch[id], hits, trials, hitRate: trials ? hits / trials : 0 };
      }
      const next = updateSourceWeights(prevW, cum);
      for (const id of ids) {
        await deps.pool.query(
          "insert into shadow_weights(source,weight,hits,trials,updated_at) values ($1,$2,$3,$4,now()) on conflict (source) do update set weight=$2, hits=$3, trials=$4, updated_at=now()",
          [id, next[id], cum[id].hits, cum[id].trials],
        );
        weightsUpdated++;
      }
    }
  }
  deps.log?.(`shadow outcomes: checked ${open.length}, closed ${closed}, weights updated ${weightsUpdated}`);
  return { checked: open.length, closed, weightsUpdated };
}

// ---------- summary ----------
export interface PolicyStats { trades: number; closed: number; open: number; wins: number; hitRate: number | null; pnl: number; maxDrawdown: number; avgSize: number }
export interface Bucket { start: string; learned: number; equal: number; diff: number }

export function maxDrawdownOf(pnls: number[]): number {
  let cum = 0, peak = 0, dd = 0;
  for (const p of pnls) { cum += p; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return dd;
}
export function zOfDiffs(d: number[]): number {
  if (d.length < 2) return 0;
  const m = d.reduce((s, x) => s + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1));
  return sd > 0 ? m / (sd / Math.sqrt(d.length)) : 0;
}

export function buildShadowVerdict(a: { learnedClosed: number; equalClosed: number; delta: number; z: number; buckets: number; minTrades?: number }): string {
  const min = a.minTrades ?? 20;
  if (a.learnedClosed < min || a.equalClosed < min) return `Not enough closed trades yet (learned ${a.learnedClosed}, equal ${a.equalClosed}; need ${min} each) to say whether learning helps.`;
  const f = (x: number) => x.toFixed(2);
  const noise = Math.abs(a.z) < 2;
  const base = `Over ${a.buckets} time buckets the learned policy is ${a.delta >= 0 ? "ahead of" : "behind"} the equal-weight policy by ${f(Math.abs(a.delta))} USD per bucket (rough z=${f(a.z)}; this is a rough check, not a formal test).`;
  return noise ? `${base} That difference is within its own noise, so we cannot claim learning helps or hurts.` : a.delta > 0 ? `${base} This is beyond noise on this sample, but treat it as early evidence only.` : `${base} The learned policy is doing worse beyond noise on this sample.`;
}

export async function shadowSummary(pool: Queryable, bucketHours = 6) {
  const rows = (await pool.query("select policy,status,size,pnl,closed_at from shadow_trades order by closed_at nulls last")).rows;
  const per = {} as Record<Policy, PolicyStats>;
  for (const p of POLICIES) {
    const mine = rows.filter((r) => r.policy === p);
    const closed = mine.filter((r) => r.status === "closed");
    per[p] = {
      trades: mine.length, closed: closed.length, open: mine.length - closed.length, wins: closed.filter((r) => +r.pnl > 0).length,
      hitRate: closed.length ? closed.filter((r) => +r.pnl > 0).length / closed.length : null,
      pnl: closed.reduce((s, r) => s + +r.pnl, 0), maxDrawdown: maxDrawdownOf(closed.map((r) => +r.pnl)),
      avgSize: mine.length ? mine.reduce((s, r) => s + +r.size, 0) / mine.length : 0,
    };
  }
  const bucketMs = bucketHours * 3600_000;
  const map = new Map<number, { learned: number; equal: number }>();
  for (const r of rows) {
    if (r.status !== "closed" || !r.closed_at) continue;
    const k = Math.floor(new Date(r.closed_at).getTime() / bucketMs) * bucketMs;
    const b = map.get(k) ?? { learned: 0, equal: 0 };
    b[r.policy as Policy] += +r.pnl;
    map.set(k, b);
  }
  const buckets: Bucket[] = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ start: new Date(k).toISOString(), learned: b.learned, equal: b.equal, diff: b.learned - b.equal }));
  const diffs = buckets.map((b) => b.diff);
  const delta = diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : 0;
  const z = zOfDiffs(diffs);
  return {
    policies: per, buckets, difference: { learnedMinusEqualTotal: per.learned.pnl - per.equal.pnl, meanPerBucket: delta, z },
    verdict: buildShadowVerdict({ learnedClosed: per.learned.closed, equalClosed: per.equal.closed, delta, z, buckets: buckets.length }),
  };
}
