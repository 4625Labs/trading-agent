import { Simulator, type SimPosition } from "../simulator.ts";
import type { Candle } from "../learning/replay.ts";
import { mulberry32 } from "../learning/replay.ts";
import { sourceStats } from "../learning/stats.ts";
import { updateSourceWeights, weightedVote, DEFAULT_WEIGHT_OPTS } from "../learning/weights.ts";
import { brier } from "../learning/calibration.ts";
import { lessonsFromTrades } from "../learning/lessons.ts";
import type { ClosedTrade, SignalRef } from "../learning/types.ts";
import { technicalSignals, plantedSignals, clamp, type SrcSignal, type Dir } from "./sources.ts";

export const WARMUP = 30;
export const STOP_PCT = 0.02, TARGET_PCT = 0.04, MAX_HOLD = 12, TRADE_USD = 100, MIN_VOTE = 0.3;
export const ASSETS = ["BTC", "ETH", "SOL"];

export type ArmName = "learner" | "baseline" | "llm_lessons" | "llm_nolessons";
export interface Decision { asset: string; direction: Dir; size: number; confidence: number }
export interface LlmDecider {
  (arm: "llm_lessons" | "llm_nolessons", ctx: { signals: SrcSignal[]; prices: Record<string, number>; hitRates: Record<string, { rate: number; trials: number }>; lessons: string[] }): Promise<Decision[] | null>;
}
export interface CycleRow {
  n: number; arm: ArmName; simTs: string; trades: number; pnl: number; cumPnl: number; hitRate20: number | null; brier: number | null;
  weights: Record<string, number>; lessons: number; detail: Record<string, unknown>;
}
export interface ArmResult {
  arm: ArmName; cum: number[]; cyclePnl: number[]; cycleWins: number[]; cycleTrades: number[]; resolved: ClosedTrade[]; weights: Record<string, number>;
}
export interface EngineOpts {
  cycles: number; seed: number; klines: Record<string, Candle[]>; sources: "all" | "technical";
  arms: ArmName[]; llm?: LlmDecider | null; onCycle?: (rows: CycleRow[], n: number) => Promise<void> | void; log?: (s: string) => void;
}

interface Open { pos: SimPosition; idx: number; signals: SignalRef[]; confidence: number; stop: number; target: number }
class Arm {
  name: ArmName;
  learns: boolean;
  w: Record<string, number> = {};
  sim: Simulator;
  px = 0;
  open: Open[] = [];
  resolved: ClosedTrade[] = [];
  res: ArmResult;
  lessons: string[] = [];
  seq = 0;
  constructor(name: ArmName) {
    this.name = name;
    this.learns = name === "learner";
    this.sim = new Simulator(async () => this.px);
    this.res = { arm: name, cum: [], cyclePnl: [], cycleWins: [], cycleTrades: [], resolved: this.resolved, weights: this.w };
  }
}

export function maxDrawdown(cum: number[]): number {
  let peak = 0, dd = 0;
  for (const v of cum) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); }
  return dd;
}

/** Walk-forward replay: cycle k decides at candle WARMUP+k using data <= that candle; trades resolve on later candles. */
export async function runEngine(o: EngineOpts): Promise<Record<ArmName, ArmResult> & { llmCalls: number; skippedLlm: number }> {
  const log = o.log ?? (() => {});
  const rng = mulberry32(o.seed);
  const arms = o.arms.map((a) => new Arm(a));
  const learner = arms.find((a) => a.name === "learner");
  const maxCycles = Math.min(...ASSETS.map((a) => o.klines[a].length)) - WARMUP - 14;
  if (o.cycles > maxCycles) throw new Error(`only ${maxCycles} cycles of data available`);
  let llmCalls = 0, skippedLlm = 0;

  for (let k = 0; k < o.cycles; k++) {
    const i = WARMUP + k;
    const last = k === o.cycles - 1;
    const prices: Record<string, number> = Object.fromEntries(ASSETS.map((a) => [a, o.klines[a][i].c]));
    const resolvedNow = new Map<Arm, { pnl: number; wins: number; n: number }>();

    // 1. resolve open positions against candle i (adverse extreme first)
    for (const a of arms) {
      const acc = { pnl: 0, wins: 0, n: 0 };
      for (const op of [...a.open]) {
        const cd = o.klines[op.pos.thesis.asset][i];
        const long = op.pos.thesis.direction === "long";
        let level: number | null = null, reason: SimPosition["exitReason"] = "manual";
        if (long ? cd.l <= op.stop : cd.h >= op.stop) { level = op.stop; reason = "stop"; }
        else if (long ? cd.h >= op.target : cd.l <= op.target) { level = op.target; reason = "target"; }
        else if (i - op.idx >= MAX_HOLD || last) { level = cd.c; reason = "manual"; }
        if (level === null) continue;
        a.sim.close(op.pos, level, reason);
        a.open.splice(a.open.indexOf(op), 1);
        const pnl = op.pos.pnl!;
        acc.pnl += pnl; acc.n++; if (pnl > 0) acc.wins++;
        a.resolved.push({ thesisId: op.pos.thesis.id, asset: op.pos.thesis.asset, direction: op.pos.thesis.direction, confidence: op.confidence, pnl, signals: op.signals });
      }
      resolvedNow.set(a, acc);
    }
    // 2. learner learns only from outcomes resolved so far
    if (learner && resolvedNow.get(learner)!.n) {
      const stats = sourceStats(learner.resolved);
      const ids = new Set([...Object.keys(learner.w), ...Object.keys(stats)]);
      const prev = Object.fromEntries([...ids].map((s) => [s, learner.w[s] ?? 1]));
      Object.assign(learner.w, updateSourceWeights(prev, stats, DEFAULT_WEIGHT_OPTS));
      learner.lessons = lessonsFromTrades(learner.resolved, { minTrials: 4, loseRate: 0.6, winRate: 0.8, sourceLabel: (s) => s }).map((l) => l.text);
    }

    // 3. signals from data <= i (planted RNG draws happen every cycle for determinism)
    const signals: SrcSignal[] = [];
    for (const asset of ASSETS) {
      if (o.sources === "all") signals.push(...plantedSignals(o.klines[asset], i, asset, rng));
      signals.push(...technicalSignals(o.klines[asset], i, asset));
    }

    // 4. decisions
    if (!last) {
      for (const a of arms) {
        let decisions: Decision[] = [];
        if (a.name === "learner" || a.name === "baseline") {
          for (const asset of ASSETS) {
            const sg = signals.filter((s) => s.asset === asset).map((s) => ({ sourceId: s.source, direction: s.direction, confidence: s.confidence }));
            const v = weightedVote(sg, a.name === "learner" ? a.w : {});
            if (Math.abs(v) < MIN_VOTE) continue;
            const dir: Dir = v > 0 ? "long" : "short";
            const agree = sg.filter((s) => s.direction === dir);
            decisions.push({ asset, direction: dir, size: TRADE_USD, confidence: agree.reduce((s, x) => s + x.confidence, 0) / agree.length });
          }
        } else if (o.llm) {
          if (llmCalls >= 260) { skippedLlm++; log(`llm budget exhausted; ${a.name} skips cycle ${k + 1}`); }
          else {
            llmCalls++;
            const st = sourceStats(a.resolved);
            const hitRates = Object.fromEntries(Object.entries(st).map(([s, x]) => [s, { rate: x.hitRate, trials: x.trials }]));
            const d = await o.llm(a.name, { signals, prices, hitRates, lessons: a.name === "llm_lessons" ? (learner?.lessons ?? []) : [] });
            if (d === null) { skippedLlm++; log(`${a.name} skipped cycle ${k + 1}`); } else decisions = d;
          }
        }
        for (const d of decisions) {
          a.px = prices[d.asset];
          const long = d.direction === "long";
          const entry = a.px;
          const stop = entry * (1 + (long ? -STOP_PCT : STOP_PCT)), target = entry * (1 + (long ? TARGET_PCT : -TARGET_PCT));
          const th = { id: `${a.name}-${k}-${d.asset}-${a.seq++}`, asset: d.asset, direction: d.direction, entry, size: d.size, stop, target, rationale: "", confidence: d.confidence, signalIds: [] };
          await a.sim.placeOrder(th);
          const sigs: SignalRef[] = signals.filter((s) => s.asset === d.asset).map((s) => ({ sourceId: s.source, direction: s.direction, confidence: s.confidence }));
          a.open.push({ pos: a.sim.positions.get(th.id)!, idx: i, signals: sigs, confidence: d.confidence, stop, target });
        }
      }
    }

    // 5. record
    const rows: CycleRow[] = [];
    for (const a of arms) {
      const acc = resolvedNow.get(a)!;
      const prevCum = a.res.cum.length ? a.res.cum[a.res.cum.length - 1] : 0;
      a.res.cum.push(prevCum + acc.pnl); a.res.cyclePnl.push(acc.pnl); a.res.cycleWins.push(acc.wins); a.res.cycleTrades.push(acc.n);
      const w20 = a.res.cycleWins.slice(-20).reduce((s, x) => s + x, 0), n20 = a.res.cycleTrades.slice(-20).reduce((s, x) => s + x, 0);
      rows.push({
        n: k + 1, arm: a.name, simTs: new Date(o.klines.BTC[i].t).toISOString(), trades: acc.n, pnl: acc.pnl, cumPnl: prevCum + acc.pnl,
        hitRate20: n20 ? w20 / n20 : null,
        brier: a.resolved.length ? brier(a.resolved.map((t) => ({ confidence: t.confidence, outcome: (t.pnl > 0 ? 1 : 0) as 0 | 1 }))) : null,
        weights: a.name === "learner" ? { ...a.w } : {}, lessons: a.name === "learner" ? a.lessons.length : a.name === "llm_lessons" ? (learner?.lessons.length ?? 0) : 0,
        detail: { resolved: acc.n, open: a.open.length, llmCalls },
      });
    }
    await o.onCycle?.(rows, k + 1);
  }
  const out: any = { llmCalls, skippedLlm };
  for (const a of arms) { a.res.weights = a.w; out[a.name] = a.res; }
  return out;
}

export { clamp };
