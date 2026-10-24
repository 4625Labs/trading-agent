import type { SourceStat } from "./stats.ts";

export interface WeightOpts {
  lr: number; // EMA step toward the target, 0..1
  floor: number;
  cap: number;
  sharpness?: number; // weight = 1 + sharpness * (posteriorHitRate - 0.5)
}
export const DEFAULT_WEIGHT_OPTS: WeightOpts = { lr: 0.25, floor: 0.05, cap: 3, sharpness: 6 };

/** Target weight from a Beta(1,1)-smoothed hit rate: 0.5 -> 1.0, better -> above 1, worse -> below. */
export function targetWeight(stat: Pick<SourceStat, "hits" | "trials">, sharpness = 6): number {
  const post = (stat.hits + 1) / (stat.trials + 2);
  return 1 + sharpness * (post - 0.5);
}

/** EMA toward the target, bounded to [floor, cap]. Sources without stats keep their weight (default 1). */
export function updateSourceWeights(prev: Record<string, number>, stats: Record<string, SourceStat>, o: WeightOpts = DEFAULT_WEIGHT_OPTS): Record<string, number> {
  const clamp = (x: number) => Math.min(o.cap, Math.max(o.floor, x));
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(prev), ...Object.keys(stats)])) {
    const p = prev[id] ?? 1;
    const s = stats[id];
    out[id] = clamp(s ? p + o.lr * (targetWeight(s, o.sharpness ?? 6) - p) : p);
  }
  return out;
}

/** Weighted directional vote over signals: >0 long, <0 short. */
export function weightedVote(signals: { sourceId: string; direction: "long" | "short"; confidence: number }[], weights: Record<string, number>): number {
  return signals.reduce((s, x) => s + (weights[x.sourceId] ?? 1) * x.confidence * (x.direction === "long" ? 1 : -1), 0);
}
