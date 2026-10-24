import type { ClosedTrade } from "./types.ts";

export interface SourceStat {
  trials: number;
  hits: number;
  hitRate: number;
  avgPnl: number;
  totalPnl: number;
}

/** A signal "hit" if it agreed with a winning trade or disagreed with a losing one. Breakeven trades are skipped. */
export function sourceStats(trades: ClosedTrade[]): Record<string, SourceStat> {
  const acc: Record<string, { trials: number; hits: number; total: number }> = {};
  for (const t of trades) {
    if (t.pnl === 0) continue;
    const won = t.pnl > 0;
    const seen = new Set<string>();
    for (const s of t.signals) {
      if (seen.has(s.sourceId)) continue; // one vote per source per trade
      seen.add(s.sourceId);
      const agreed = s.direction === t.direction;
      const a = (acc[s.sourceId] ??= { trials: 0, hits: 0, total: 0 });
      a.trials++;
      if (agreed === won) a.hits++;
      a.total += agreed ? t.pnl : -t.pnl; // pnl "as if" the source's own direction was traded
    }
  }
  const out: Record<string, SourceStat> = {};
  for (const [id, a] of Object.entries(acc)) {
    out[id] = { trials: a.trials, hits: a.hits, hitRate: a.trials ? a.hits / a.trials : 0, avgPnl: a.trials ? a.total / a.trials : 0, totalPnl: a.total };
  }
  return out;
}
