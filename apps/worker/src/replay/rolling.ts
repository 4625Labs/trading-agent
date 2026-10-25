import { readFileSync } from "node:fs";
import { Simulator, type SimPosition } from "../simulator.ts";
import { mulberry32, type Candle } from "../learning/replay.ts";
import { sourceStats } from "../learning/stats.ts";
import { updateSourceWeights, weightedVote, DEFAULT_WEIGHT_OPTS } from "../learning/weights.ts";
import { brier, fitCalibration, confidenceAdjust } from "../learning/calibration.ts";
import type { ClosedTrade, SignalRef, Queryable } from "../learning/types.ts";
import { ASSETS, STOP_PCT, TARGET_PCT, MAX_HOLD, TRADE_USD, MIN_VOTE, maxDrawdown } from "./engine.ts";
import { PLANTED, TECHNICAL, plantedSignals, technicalSignals, type SrcSignal, type Dir } from "./sources.ts";

export const ROLLING_DISCLAIMER = "Replay on historical prices, not live trading; learning is frozen before each test; windows chosen at random; past performance does not predict future results.";
export const LOOKBACK = 30; // candles of history the technical sources need before the first decision
const STEP_MS = 4 * 3600 * 1000;

export type SourceSet = "technical" | "all";
export type TestArm = "learned" | "baseline" | "continuing";

/** Load the cached 2-year history (compact [t,o,h,l,c] arrays). */
export function loadHistory(): Record<string, Candle[]> {
  const out: Record<string, Candle[]> = {};
  for (const a of ASSETS) {
    const raw = JSON.parse(readFileSync(new URL(`../../data/klines-4h-${a}.json`, import.meta.url), "utf8")) as number[][];
    out[a] = raw.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] }));
  }
  return out;
}

interface Open { pos: SimPosition; idx: number; signals: SignalRef[]; confidence: number; stop: number; target: number }
class Book {
  sim: Simulator;
  px = 0;
  open: Open[] = [];
  resolved: ClosedTrade[] = [];
  seq = 0;
  cyclePnl: number[] = [];
  cycleWins: number[] = [];
  cycleTrades: number[] = [];
  constructor() { this.sim = new Simulator(async () => this.px); }
}

/** Resolve open positions against candle i (adverse extreme first). `forceAll` closes everything at the candle close. */
function resolve(b: Book, cs: Record<string, Candle[]>, i: number, forceAll: boolean) {
  const acc = { pnl: 0, wins: 0, n: 0 };
  for (const op of [...b.open]) {
    const cd = cs[op.pos.thesis.asset][i];
    const long = op.pos.thesis.direction === "long";
    let level: number | null = null, reason: SimPosition["exitReason"] = "manual";
    if (long ? cd.l <= op.stop : cd.h >= op.stop) { level = op.stop; reason = "stop"; }
    else if (long ? cd.h >= op.target : cd.l <= op.target) { level = op.target; reason = "target"; }
    else if (i - op.idx >= MAX_HOLD || forceAll) level = cd.c;
    if (level === null) continue;
    b.sim.close(op.pos, level, reason);
    b.open.splice(b.open.indexOf(op), 1);
    const pnl = op.pos.pnl!;
    acc.pnl += pnl; acc.n++; if (pnl > 0) acc.wins++;
    b.resolved.push({ thesisId: op.pos.thesis.id, asset: op.pos.thesis.asset, direction: op.pos.thesis.direction, confidence: op.confidence, pnl, signals: op.signals });
  }
  return acc;
}

async function openTrades(b: Book, cs: Record<string, Candle[]>, i: number, signals: SrcSignal[], w: Record<string, number>, tag: string) {
  for (const asset of ASSETS) {
    const sg: SignalRef[] = signals.filter((s) => s.asset === asset).map((s) => ({ sourceId: s.source, direction: s.direction, confidence: s.confidence }));
    const v = weightedVote(sg, w);
    if (Math.abs(v) < MIN_VOTE) continue;
    const dir: Dir = v > 0 ? "long" : "short";
    const agree = sg.filter((s) => s.direction === dir);
    const conf = agree.reduce((s, x) => s + x.confidence, 0) / agree.length;
    const entry = cs[asset][i].c;
    b.px = entry;
    const long = dir === "long";
    const stop = entry * (1 + (long ? -STOP_PCT : STOP_PCT)), target = entry * (1 + (long ? TARGET_PCT : -TARGET_PCT));
    const th = { id: `${tag}-${i}-${asset}-${b.seq++}`, asset, direction: dir, entry, size: TRADE_USD, stop, target, rationale: "", confidence: conf, signalIds: [] };
    await b.sim.placeOrder(th);
    b.open.push({ pos: b.sim.positions.get(th.id)!, idx: i, signals: sg, confidence: conf, stop, target });
  }
}

export interface ArmOutcome { pnl: number; trades: number; wins: number; hit: number | null; maxDD: number }
export interface WindowResult {
  sources: SourceSet;
  frozen: Record<string, number>;
  learnTrades: number;
  discardedOpenAtFreeze: number;
  arms: Record<TestArm, ArmOutcome>;
  delta: number; // learned - baseline, test stretch only
  deltaContinuing: number;
  sourceStats: Record<string, { trials: number; hits: number; hitRate: number }>;
  brierRaw: number | null;
  brierCalibrated: number | null;
}

/**
 * One window on candles already sliced to [start-LOOKBACK .. end] (nothing after `end` is visible).
 * Learn phase (L cycles): the learner trades and updates weights only from trades that have already resolved.
 * Freeze rule: positions still open at the freeze point are DISCARDED (never marked, never counted in learning), so nothing about
 * later prices leaks into the weights and the test stretch starts flat. Weights and calibration are then frozen.
 * Test phase (M cycles): frozen-learned vs equal-weight baseline (and a continuing learner), same signals, prices and execution.
 * Positions open at the last test candle are force-closed at its close.
 */
export async function simulateWindow(cs: Record<string, Candle[]>, L: number, M: number, sources: SourceSet, seed: number): Promise<WindowResult> {
  const rng = mulberry32(seed);
  const learner = new Book();
  let w: Record<string, number> = {};
  const signalsAt = (i: number): SrcSignal[] => {
    const out: SrcSignal[] = [];
    for (const asset of ASSETS) {
      if (sources === "all") out.push(...plantedSignals(cs[asset], i, asset, rng));
      out.push(...technicalSignals(cs[asset], i, asset));
    }
    return out;
  };
  const testSignals: SrcSignal[][] = [];
  // --- learn phase
  for (let k = 0; k < L; k++) {
    const i = LOOKBACK + k;
    const r = resolve(learner, cs, i, false);
    if (r.n) {
      const st = sourceStats(learner.resolved);
      const prev = Object.fromEntries([...new Set([...Object.keys(w), ...Object.keys(st)])].map((s) => [s, w[s] ?? 1]));
      w = updateSourceWeights(prev, st, DEFAULT_WEIGHT_OPTS);
    }
    const sg = signalsAt(i);
    if (k < L - 1) await openTrades(learner, cs, i, sg, w, "learn");
  }
  const discarded = learner.open.length;
  const frozen = { ...w };
  const history = learner.resolved.slice();
  const model = fitCalibration(history.filter((t) => t.pnl !== 0).map((t) => ({ confidence: t.confidence, outcome: (t.pnl > 0 ? 1 : 0) as 0 | 1 })));

  // --- test phase (decisions at candles LOOKBACK+L .. LOOKBACK+L+M-1)
  const books: Record<TestArm, Book> = { learned: new Book(), baseline: new Book(), continuing: new Book() };
  books.continuing.resolved = history.slice();
  let wc = { ...frozen };
  const ws: Record<TestArm, () => Record<string, number>> = { learned: () => frozen, baseline: () => ({}), continuing: () => wc };
  for (let k = 0; k < M; k++) {
    const i = LOOKBACK + L + k;
    const last = k === M - 1;
    for (const arm of ["learned", "baseline", "continuing"] as TestArm[]) {
      const b = books[arm];
      const r = resolve(b, cs, i, last);
      b.cyclePnl.push(r.pnl); b.cycleWins.push(r.wins); b.cycleTrades.push(r.n);
      if (arm === "continuing" && r.n) {
        const st = sourceStats(b.resolved);
        const prev = Object.fromEntries([...new Set([...Object.keys(wc), ...Object.keys(st)])].map((s) => [s, wc[s] ?? 1]));
        wc = updateSourceWeights(prev, st, DEFAULT_WEIGHT_OPTS);
      }
    }
    const sg = signalsAt(i);
    testSignals.push(sg);
    if (!last) for (const arm of ["learned", "baseline", "continuing"] as TestArm[]) await openTrades(books[arm], cs, i, sg, ws[arm](), arm);
  }
  const outcome = (b: Book): ArmOutcome => {
    const cum: number[] = [];
    let c = 0;
    for (const p of b.cyclePnl) cum.push((c += p));
    const trades = b.cycleTrades.reduce((s, x) => s + x, 0), wins = b.cycleWins.reduce((s, x) => s + x, 0);
    return { pnl: c, trades, wins, hit: trades ? wins / trades : null, maxDD: maxDrawdown(cum) };
  };
  const arms = { learned: outcome(books.learned), baseline: outcome(books.baseline), continuing: outcome(books.continuing) };
  const lt = books.learned.resolved.filter((t) => t.pnl !== 0);
  const pts = lt.map((t) => ({ confidence: t.confidence, outcome: (t.pnl > 0 ? 1 : 0) as 0 | 1 }));
  const st = sourceStats(history);
  return {
    sources, frozen, learnTrades: history.length, discardedOpenAtFreeze: discarded, arms,
    delta: arms.learned.pnl - arms.baseline.pnl, deltaContinuing: arms.continuing.pnl - arms.baseline.pnl,
    sourceStats: Object.fromEntries(Object.entries(st).map(([s, x]) => [s, { trials: x.trials, hits: x.hits, hitRate: +x.hitRate.toFixed(3) }])),
    brierRaw: pts.length ? brier(pts) : null,
    brierCalibrated: pts.length ? brier(pts.map((p) => ({ confidence: confidenceAdjust(model, p.confidence), outcome: p.outcome }))) : null,
  };
}

// ---------- statistics
const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042 };
/** Two-sided 95% t critical value (table to df=30, then interpolated toward 1.96). */
export function tCrit95(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T95[df];
  if (df <= 40) return 2.042 + (2.021 - 2.042) * ((df - 30) / 10);
  if (df <= 60) return 2.021 + (2.0 - 2.021) * ((df - 40) / 20);
  if (df <= 120) return 2.0 + (1.98 - 2.0) * ((df - 60) / 60);
  return 1.96;
}
/** Exact two-sided binomial sign test (ties dropped). */
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let c = 1, cdf = 0; // C(n,0)
  for (let i = 0; i <= k; i++) { cdf += c; c = (c * (n - i)) / (i + 1); }
  return Math.min(1, (2 * cdf) / 2 ** n);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sdev = (xs: number[]) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : 0; };

export function deltaStats(deltas: number[]) {
  const n = deltas.length, m = mean(deltas), sd = sdev(deltas), se = n ? sd / Math.sqrt(n) : 0;
  const crit = tCrit95(n - 1);
  const wins = deltas.filter((d) => d > 0).length, losses = deltas.filter((d) => d < 0).length;
  return {
    n, meanDelta: m, sd, se, ci95: [m - crit * se, m + crit * se] as [number, number], ciMethod: "t-distribution, df=n-1",
    t: se > 0 ? m / se : 0, windowsWon: wins, windowsLost: losses, shareWon: n ? wins / n : 0, signTestP: signTestP(wins, losses),
  };
}

const f = (x: number, d = 2) => x.toFixed(d);
export function rollingVerdict(tech: ReturnType<typeof deltaStats>, all: ReturnType<typeof deltaStats>): string {
  const one = (s: ReturnType<typeof deltaStats>, name: string) =>
    s.ci95[0] > 0 ? `${name}: the frozen learned weights beat equal weights by ${f(s.meanDelta)} USD per ${"test stretch"} on average (95% CI ${f(s.ci95[0])} to ${f(s.ci95[1])}, beat the baseline in ${s.windowsWon}/${s.n} windows, sign-test p=${f(s.signTestP, 3)}).`
    : s.ci95[1] < 0 ? `${name}: the frozen learned weights did WORSE than equal weights by ${f(-s.meanDelta)} USD per test stretch on average (95% CI ${f(s.ci95[0])} to ${f(s.ci95[1])}, won ${s.windowsWon}/${s.n}).`
    : `${name}: no reliable improvement. Mean difference ${f(s.meanDelta)} USD per test stretch with a 95% CI of ${f(s.ci95[0])} to ${f(s.ci95[1])}, which includes 0 (won ${s.windowsWon}/${s.n} windows, sign-test p=${f(s.signTestP, 3)}).`;
  return `${one(tech, "On the real technical sources (the honest real-data result)")} ${one(all, "With the planted synthetic sources added (shows the mechanism works when an edge exists)")}`;
}

// ---------- runner
export interface RollingDeps {
  pool: Queryable | null;
  windows?: number;
  learnCycles?: number;
  testCycles?: number;
  seed?: number;
  log?: (s: string) => void;
  onProgress?: (done: number) => void;
  runId?: string;
  klines?: Record<string, Candle[]>;
}

/** Seeded, non-overlapping (where possible) window starts. A start s uses candles [s-LOOKBACK .. s+L+M-1]; windows may not cross a time gap. */
export function chooseStarts(cs: Candle[], K: number, span: number, seed: number): number[] {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const n = cs.length;
  const bad = new Set<number>(); // index i where cs[i].t - cs[i-1].t != STEP
  for (let i = 1; i < n; i++) if (cs[i].t - cs[i - 1].t !== STEP_MS) bad.add(i);
  const ok = (s: number) => { for (const g of bad) if (g > s - LOOKBACK && g <= s + span - 1) return false; return true; };
  const lo = LOOKBACK, hi = n - span;
  const picked: number[] = [];
  for (let tries = 0; picked.length < K && tries < 20000; tries++) {
    const s = lo + Math.floor(rng() * (hi - lo + 1));
    if (!ok(s)) continue;
    const overlap = picked.some((p) => Math.abs(p - s) < span);
    if (overlap && tries < 15000) continue;
    picked.push(s);
  }
  return picked.sort((a, b) => a - b);
}

export async function runRollingTest(deps: RollingDeps) {
  const K = deps.windows ?? 25, L = deps.learnCycles ?? 30, M = deps.testCycles ?? 20, seed = deps.seed ?? 42;
  const log = deps.log ?? (() => {});
  const klines = deps.klines ?? loadHistory();
  const pool = deps.pool;
  const span = L + M;
  const base = klines.BTC;
  const params = { windows: K, learnCycles: L, testCycles: M, seed, candles: "4h", historyStart: new Date(base[0].t).toISOString(), historyEnd: new Date(base[base.length - 1].t).toISOString(), stopPct: STOP_PCT, targetPct: TARGET_PCT, maxHold: MAX_HOLD };
  let runId = deps.runId ?? "";
  if (pool) {
    if (runId) await pool.query("insert into rolling_runs(id,params) values ($1,$2)", [runId, params]);
    else runId = (await pool.query("insert into rolling_runs(params) values ($1) returning id", [params])).rows[0].id;
  }
  try {
    const starts = chooseStarts(base, K, span, seed);
    if (starts.length < K) log(`only ${starts.length} windows fit`);
    const windows: { k: number; startIdx: number; endIdx: number; startTs: string; technical: WindowResult; all: WindowResult }[] = [];
    for (let k = 0; k < starts.length; k++) {
      const s = starts[k], e = s + span - 1;
      // slice: nothing after the window end is visible to any code below
      const slice: Record<string, Candle[]> = {};
      for (const a of ASSETS) slice[a] = klines[a].slice(s - LOOKBACK, e + 1);
      const wseed = (seed * 1000003 + k) >>> 0;
      const technical = await simulateWindow(slice, L, M, "technical", wseed);
      const all = await simulateWindow(slice, L, M, "all", wseed);
      const rec = { k: k + 1, startIdx: s, endIdx: e, startTs: new Date(base[s].t).toISOString(), technical, all };
      windows.push(rec);
      if (pool) {
        const t = technical;
        await pool.query(
          `insert into rolling_windows(run_id,k,start_ts,learn_cycles,test_cycles,learned_pnl,baseline_pnl,delta,learned_trades,baseline_trades,learned_hit,baseline_hit,learned_maxdd,baseline_maxdd,weights,detail)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [runId, k + 1, rec.startTs, L, M, t.arms.learned.pnl, t.arms.baseline.pnl, t.delta, t.arms.learned.trades, t.arms.baseline.trades, t.arms.learned.hit, t.arms.baseline.hit, t.arms.learned.maxDD, t.arms.baseline.maxDD, t.frozen,
            { primary: "technical", technical: slim(t), allSources: slim(all), startIdx: s, endIdx: e }],
        );
        await pool.query("update rolling_runs set progress=$2 where id=$1", [runId, k + 1]);
      }
      deps.onProgress?.(k + 1);
      await new Promise((r) => setImmediate(r)); // let the live worker breathe
    }
    const block = (pick: (w: (typeof windows)[number]) => WindowResult) => {
      const rs = windows.map(pick);
      const st = deltaStats(rs.map((r) => r.delta));
      const m = (g: (r: WindowResult) => number | null) => mean(rs.map(g).filter((x): x is number => x !== null));
      return {
        ...st,
        meanLearnedPnl: m((r) => r.arms.learned.pnl), meanBaselinePnl: m((r) => r.arms.baseline.pnl),
        meanLearnedHit: m((r) => r.arms.learned.hit), meanBaselineHit: m((r) => r.arms.baseline.hit),
        meanLearnedMaxDD: m((r) => r.arms.learned.maxDD), meanBaselineMaxDD: m((r) => r.arms.baseline.maxDD),
        meanLearnedTrades: m((r) => r.arms.learned.trades), meanBaselineTrades: m((r) => r.arms.baseline.trades),
        continuingLearner: deltaStats(rs.map((r) => r.deltaContinuing)),
        meanBrierRaw: m((r) => r.brierRaw), meanBrierCalibrated: m((r) => r.brierCalibrated),
      };
    };
    const technical = block((w) => w.technical), allSources = block((w) => w.all);
    const clampW = (x: number) => Math.min(2, Math.max(0.25, x));
    const warmStartWeights: Record<string, number> = {};
    for (const s of TECHNICAL) warmStartWeights[s] = +clampW(mean(windows.map((w) => w.technical.frozen[s] ?? 1))).toFixed(3);
    const plantedWeights: Record<string, number> = {};
    for (const s of Object.keys(PLANTED)) plantedWeights[s] = +mean(windows.map((w) => w.all.frozen[s] ?? 1)).toFixed(3);
    const summary = {
      windows: windows.length, learnCycles: L, testCycles: M, seed,
      technicalOnly: technical, allSources, plantedMeanFrozenWeights: plantedWeights,
      warmStartWeights,
      verdict: rollingVerdict(technical, allSources),
      disclaimer: ROLLING_DISCLAIMER,
    };
    if (pool) await pool.query("update rolling_runs set status='done', finished_at=now(), progress=$2, summary=$3 where id=$1", [runId, windows.length, summary]);
    return { runId, params, summary, windows };
  } catch (e) {
    const msg = String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>").slice(0, 300);
    if (pool) await pool.query("update rolling_runs set status='failed', finished_at=now(), error=$2 where id=$1", [runId, msg]).catch(() => {});
    throw e;
  }
}

function slim(r: WindowResult) {
  return { frozen: r.frozen, learnTrades: r.learnTrades, discardedOpenAtFreeze: r.discardedOpenAtFreeze, arms: r.arms, delta: r.delta, deltaContinuing: r.deltaContinuing, sourceStats: r.sourceStats };
}
