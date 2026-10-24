export interface CalPoint {
  confidence: number;
  outcome: 0 | 1;
}
export interface CalBin {
  lo: number;
  hi: number;
  n: number;
  meanConf: number;
  rate: number; // observed win rate
}
export interface CalibrationModel {
  n: number;
  baseRate: number;
  bins: CalBin[];
  brier: number;
}

export function brier(points: CalPoint[]): number {
  return points.length ? points.reduce((s, p) => s + (p.confidence - p.outcome) ** 2, 0) / points.length : 0;
}

export function reliabilityBins(points: CalPoint[], nBins = 5): CalBin[] {
  const bins: CalBin[] = Array.from({ length: nBins }, (_, i) => ({ lo: i / nBins, hi: (i + 1) / nBins, n: 0, meanConf: 0, rate: 0 }));
  for (const p of points) {
    const i = Math.min(nBins - 1, Math.max(0, Math.floor(p.confidence * nBins)));
    const b = bins[i];
    b.meanConf += p.confidence;
    b.rate += p.outcome;
    b.n++;
  }
  for (const b of bins) if (b.n) { b.meanConf /= b.n; b.rate /= b.n; }
  return bins;
}

export function fitCalibration(points: CalPoint[], nBins = 5): CalibrationModel {
  const baseRate = points.length ? points.reduce((s, p) => s + p.outcome, 0) / points.length : 0.5;
  return { n: points.length, baseRate, bins: reliabilityBins(points, nBins), brier: brier(points) };
}

/** Map stated confidence to a learned one. Bins shrink toward the global base rate when sparse (pseudo-count k). */
export function confidenceAdjust(model: CalibrationModel | null | undefined, conf: number, k = 5): number {
  if (!model || model.n < 10) return conf;
  const c = Math.min(1, Math.max(0, conf));
  const b = model.bins.find((x) => c >= x.lo && c < x.hi) ?? model.bins[model.bins.length - 1];
  const shrunk = (b.n * b.rate + k * model.baseRate) / (b.n + k);
  return Math.min(0.99, Math.max(0.01, shrunk));
}
