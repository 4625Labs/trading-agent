const T95: Record<number, number> = { 1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23, 12: 2.18, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04, 40: 2.02, 60: 2.0 };
export function tcrit(df: number) {
  if (df >= 120) return 1.98;
  const ks = Object.keys(T95).map(Number).sort((a, b) => a - b);
  let best = ks[0]; for (const k of ks) if (k <= df) best = k;
  return T95[best];
}
export interface Ci { n: number; mean: number; lo: number; hi: number; t: number | null }
/** Mean with 95% t-interval; null when fewer than 3 observations. */
export function meanCi(xs: number[]): Ci | null {
  const v = xs.filter((x) => Number.isFinite(x)), n = v.length;
  if (n < 3) return null;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n), h = tcrit(n - 1) * se;
  return { n, mean, lo: mean - h, hi: mean + h, t: se > 0 ? mean / se : null };
}
export const verdictOf = (lo: number, hi: number) => (lo > 0 ? "helped" : hi < 0 ? "hurt" : "none");
export function histogram(xs: number[], bins = 10) {
  const v = xs.filter(Number.isFinite);
  if (!v.length) return [];
  const lo = Math.min(...v), hi = Math.max(...v), w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, count: 0 }));
  for (const x of v) out[Math.min(bins - 1, Math.floor((x - lo) / w))].count++;
  return out;
}
