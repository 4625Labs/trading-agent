import { Simulator } from "../simulator.ts";
import { sourceStats } from "./stats.ts";
import { updateSourceWeights, weightedVote, DEFAULT_WEIGHT_OPTS, type WeightOpts } from "./weights.ts";
import { brier, fitCalibration, confidenceAdjust } from "./calibration.ts";
import type { ClosedTrade, SignalRef } from "./types.ts";

export interface Candle { t: number; o: number; h: number; l: number; c: number }

export function parseKlines(raw: unknown[][]): Candle[] {
  return raw.map((k) => ({ t: Number(k[0]), o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string) }));
}

export async function fetchKlines(asset: string, interval = "1h", limit = 720): Promise<unknown[][]> {
  const res = await fetch(`https://api.binance.us/api/v3/klines?symbol=${asset}USDT&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`klines ${asset} -> ${res.status}`);
  return (await res.json()) as unknown[][];
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ReplayOpts {
  rounds: number;
  seed: number;
  stopPct: number;
  targetPct: number;
  horizon: number; // candles
  size: number; // USD per trade
  hitRates: Record<string, number>; // planted probability each source is right
  weightOpts: WeightOpts;
}
export const DEFAULT_REPLAY: ReplayOpts = {
  rounds: 300, seed: 42, stopPct: 0.015, targetPct: 0.015, horizon: 24, size: 100,
  hitRates: { A: 0.65, B: 0.5, C: 0.35 },
  weightOpts: { ...DEFAULT_WEIGHT_OPTS },
};

type Dir = "long" | "short";

/** Which side is touched first within the horizon (stop-loss side wins ties, conservatively). */
function truthDirection(cs: Candle[], i: number, o: ReplayOpts): Dir | null {
  const entry = cs[i].c;
  for (let j = i + 1; j <= Math.min(cs.length - 1, i + o.horizon); j++) {
    const down = cs[j].l <= entry * (1 - o.stopPct);
    const up = cs[j].h >= entry * (1 + o.targetPct);
    if (down) return "short";
    if (up) return "long";
  }
  return null;
}

/** Run one trade through the real Simulator against the candle path. */
export async function simulateTrade(cs: Candle[], i: number, asset: string, dir: Dir, o: ReplayOpts): Promise<{ pnl: number; reason: string }> {
  const entry = cs[i].c;
  let px = entry;
  const sim = new Simulator(async () => px);
  const long = dir === "long";
  const stop = entry * (1 + (long ? -o.stopPct : o.stopPct));
  const target = entry * (1 + (long ? o.targetPct : -o.targetPct));
  const thesis = { id: `r${i}${asset}${dir}`, asset, direction: dir, entry, size: o.size, stop, target, rationale: "", confidence: 0.5, signalIds: [] };
  await sim.placeOrder(thesis);
  const last = Math.min(cs.length - 1, i + o.horizon);
  for (let j = i + 1; j <= last; j++) {
    // adverse extreme first, then favourable; exits at the level touched
    const adverse = long ? cs[j].l <= stop : cs[j].h >= stop;
    const favour = long ? cs[j].h >= target : cs[j].l <= target;
    if (adverse) { sim.markToMarket({ [asset]: stop }); break; }
    if (favour) { sim.markToMarket({ [asset]: target }); break; }
  }
  const p = sim.positions.get(thesis.id)!;
  if (p.status === "open") sim.close(p, cs[last].c, "manual");
  return { pnl: p.pnl!, reason: p.exitReason! };
}

export interface ReplayReport {
  rounds: number;
  weights: Record<string, number>;
  trajectory: Record<string, number>[]; // per round, weights after the update
  learnerCum: number[];
  baselineCum: number[];
  learnerPnl: number;
  baselinePnl: number;
  learnerWinRate: number;
  baselineWinRate: number;
  brierBefore: number; // held-out half, raw stated confidence
  brierAfter: number; // held-out half, calibrated
  stats: ReturnType<typeof sourceStats>;
}

export async function runReplay(klines: Record<string, Candle[]>, partial: Partial<ReplayOpts> = {}): Promise<ReplayReport> {
  const o: ReplayOpts = { ...DEFAULT_REPLAY, ...partial };
  const rng = mulberry32(o.seed);
  const assets = Object.keys(klines);
  const ids = Object.keys(o.hitRates);
  let w: Record<string, number> = Object.fromEntries(ids.map((s) => [s, 1]));
  const trades: ClosedTrade[] = [];
  const outcomes: { conf: number; win: 0 | 1 }[] = [];
  const trajectory: Record<string, number>[] = [];
  const learnerCum: number[] = [];
  const baselineCum: number[] = [];
  let lp = 0, bp = 0, lw = 0, bw = 0, n = 0;

  for (let r = 0, attempts = 0; n < o.rounds && attempts < o.rounds * 5; attempts++) {
    const asset = assets[attempts % assets.length];
    const cs = klines[asset];
    const span = cs.length - o.horizon - 10;
    const i = 5 + Math.floor(rng() * span);
    const truth = truthDirection(cs, i, o);
    if (!truth) continue;
    r++; n++;
    const signals: SignalRef[] = ids.map((s) => {
      const right = rng() < o.hitRates[s];
      return { sourceId: s, direction: right ? truth : truth === "long" ? "short" : "long", confidence: 0.6 + 0.3 * rng() };
    });
    const dir: Dir = weightedVote(signals, w) >= 0 ? "long" : "short";
    const bdir: Dir = weightedVote(signals, {}) >= 0 ? "long" : "short";
    const lr = await simulateTrade(cs, i, asset, dir, o);
    const br = dir === bdir ? lr : await simulateTrade(cs, i, asset, bdir, o);
    lp += lr.pnl; bp += br.pnl;
    if (lr.pnl > 0) lw++;
    if (br.pnl > 0) bw++;
    learnerCum.push(lp); baselineCum.push(bp);
    const agree = signals.filter((s) => s.direction === dir);
    const conf = agree.length ? agree.reduce((s, x) => s + x.confidence, 0) / agree.length : 0.5;
    trades.push({ thesisId: `r${r}`, asset, direction: dir, confidence: conf, pnl: lr.pnl, signals });
    outcomes.push({ conf, win: lr.pnl > 0 ? 1 : 0 });
    w = updateSourceWeights(w, sourceStats(trades), o.weightOpts);
    trajectory.push({ ...w });
  }

  const half = Math.floor(outcomes.length / 2);
  const train = outcomes.slice(0, half).map((x) => ({ confidence: x.conf, outcome: x.win }));
  const test = outcomes.slice(half).map((x) => ({ confidence: x.conf, outcome: x.win }));
  const model = fitCalibration(train);
  return {
    rounds: n, weights: w, trajectory, learnerCum, baselineCum, learnerPnl: lp, baselinePnl: bp,
    learnerWinRate: n ? lw / n : 0, baselineWinRate: n ? bw / n : 0,
    brierBefore: brier(test),
    brierAfter: brier(test.map((p) => ({ confidence: confidenceAdjust(model, p.confidence), outcome: p.outcome }))),
    stats: sourceStats(trades),
  };
}

/** Compact ASCII line chart; each series gets its own glyph. */
export function asciiChart(series: Record<string, number[]>, width = 60, height = 12): string {
  const all = Object.values(series).flat();
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const grid = Array.from({ length: height }, () => Array(width).fill(" "));
  const glyphs = Object.keys(series);
  for (const name of glyphs) {
    const ys = series[name];
    for (let x = 0; x < width; x++) {
      const v = ys[Math.min(ys.length - 1, Math.floor((x / (width - 1)) * (ys.length - 1)))];
      const row = height - 1 - Math.round(((v - min) / span) * (height - 1));
      grid[row][x] = grid[row][x] === " " ? name[0] : "*";
    }
  }
  const lines = grid.map((row, i) => `${(max - (i / (height - 1)) * span).toFixed(1).padStart(8)} |${row.join("")}`);
  lines.push(`${"".padStart(8)} +${"-".repeat(width)}`);
  lines.push(`${"".padStart(10)}${glyphs.map((g) => `${g[0]}=${g}`).join("  ")}  (*=overlap)`);
  return lines.join("\n");
}
