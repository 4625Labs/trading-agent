import type { Candle } from "../learning/replay.ts";

export type Dir = "long" | "short";
export interface SrcSignal { asset: string; source: string; direction: Dir; confidence: number }

export const PLANTED: Record<string, number> = { planted_good: 0.65, planted_random: 0.5, planted_contrarian: 0.35 };
export const TECHNICAL = ["momentum", "meanrev", "breakout", "volregime"] as const;

const sign = (x: number): Dir => (x >= 0 ? "long" : "short");
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
function sd(xs: number[]) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/**
 * Technical signals from candles with index <= i ONLY (no look-ahead). Candles are 4h, so 6 candles = 24h, 12 = 48h.
 */
export function technicalSignals(cs: Candle[], i: number, asset: string): SrcSignal[] {
  const out: SrcSignal[] = [];
  if (i < 30) return out;
  const c = (k: number) => cs[k].c;
  const r24 = c(i) / c(i - 6) - 1;
  if (Math.abs(r24) >= 0.002) out.push({ asset, source: "momentum", direction: sign(r24), confidence: 0.5 + Math.min(0.4, Math.abs(r24) * 10) });

  const win = Array.from({ length: 12 }, (_, k) => c(i - 11 + k));
  const mean = win.reduce((s, x) => s + x, 0) / 12;
  const s = sd(win);
  const z = s > 0 ? (c(i) - mean) / s : 0;
  if (Math.abs(z) >= 1) out.push({ asset, source: "meanrev", direction: z > 0 ? "short" : "long", confidence: 0.5 + Math.min(0.4, (Math.abs(z) - 1) * 0.2) });

  let hi = -Infinity, lo = Infinity;
  for (let k = i - 20; k < i; k++) { hi = Math.max(hi, cs[k].h); lo = Math.min(lo, cs[k].l); }
  if (c(i) > hi) out.push({ asset, source: "breakout", direction: "long", confidence: 0.65 });
  else if (c(i) < lo) out.push({ asset, source: "breakout", direction: "short", confidence: 0.65 });

  const vol = (e: number) => sd(Array.from({ length: 6 }, (_, k) => c(e - k) / c(e - k - 1) - 1));
  const vols = Array.from({ length: 12 }, (_, k) => vol(i - k)).sort((a, b) => a - b);
  const median = (vols[5] + vols[6]) / 2;
  if (r24 !== 0) out.push({ asset, source: "volregime", direction: vol(i) > median ? sign(r24) : sign(-r24), confidence: 0.55 });
  return out;
}

/**
 * Planted-truth oracle (synthetic by design, it peeks at the future on purpose): the direction whose trade would WIN under the
 * replay's exit rules (-2% stop / +4% target / 12-candle limit). Null when neither side wins (source then guesses).
 */
export function plantedTruth(cs: Candle[], i: number): Dir | null {
  const e = cs[i].c;
  const end = Math.min(cs.length - 1, i + 12);
  let longRes: boolean | null = null, shortRes: boolean | null = null;
  for (let j = i + 1; j <= end; j++) {
    if (longRes === null) { if (cs[j].l <= e * 0.98) longRes = false; else if (cs[j].h >= e * 1.04) longRes = true; }
    if (shortRes === null) { if (cs[j].h >= e * 1.02) shortRes = false; else if (cs[j].l <= e * 0.96) shortRes = true; }
  }
  const tail = cs[end].c / e - 1;
  if (longRes === null) longRes = tail > 0.003;
  if (shortRes === null) shortRes = tail < -0.003;
  return longRes && !shortRes ? "long" : shortRes && !longRes ? "short" : longRes && shortRes ? (tail >= 0 ? "long" : "short") : null;
}

export function plantedSignals(cs: Candle[], i: number, asset: string, rng: () => number): SrcSignal[] {
  const truth = plantedTruth(cs, i);
  const out: SrcSignal[] = [];
  for (const [source, p] of Object.entries(PLANTED)) {
    // always consume the same draws so determinism does not depend on truth
    const right = rng() < p, coin = rng() < 0.5, confDraw = rng();
    const t = truth ?? (coin ? "long" : "short");
    out.push({ asset, source, direction: right ? t : t === "long" ? "short" : "long", confidence: 0.6 + 0.3 * confDraw });
  }
  return out;
}
export { clamp };
