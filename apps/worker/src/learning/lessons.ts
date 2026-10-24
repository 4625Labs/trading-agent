import type { ClosedTrade } from "./types.ts";

export interface Lesson {
  key: string; // stable dedupe key; text may be refreshed as counts grow
  text: string;
}
export interface LessonOpts {
  minTrials: number;
  loseRate: number; // flag groups losing at least this fraction
  winRate: number;
  sourceLabel?: (id: string) => string;
}
export const DEFAULT_LESSON_OPTS: LessonOpts = { minTrials: 5, loseRate: 0.6, winRate: 0.8 };

/** Deterministic rule-derived lessons per (asset, direction, source). */
export function lessonsFromTrades(trades: ClosedTrade[], o: LessonOpts = DEFAULT_LESSON_OPTS): Lesson[] {
  const groups = new Map<string, { asset: string; dir: string; src: string; n: number; wins: number; pnl: number }>();
  for (const t of trades) {
    if (t.pnl === 0) continue;
    for (const src of new Set(t.signals.map((s) => s.sourceId))) {
      const key = `${t.asset}:${t.direction}:${src}`;
      const g = groups.get(key) ?? { asset: t.asset, dir: t.direction, src, n: 0, wins: 0, pnl: 0 };
      g.n++;
      if (t.pnl > 0) g.wins++;
      g.pnl += t.pnl;
      groups.set(key, g);
    }
  }
  const out: Lesson[] = [];
  for (const [key, g] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (g.n < o.minTrials) continue;
    const label = o.sourceLabel ? o.sourceLabel(g.src) : g.src;
    const losses = g.n - g.wins;
    const dir = `${g.asset} ${g.dir}s`;
    if (losses / g.n >= o.loseRate) out.push({ key, text: `${dir} from source ${label} lost ${losses}/${g.n} (net ${g.pnl.toFixed(2)} USD); reduce size or skip.` });
    else if (g.wins / g.n >= o.winRate) out.push({ key, text: `${dir} from source ${label} won ${g.wins}/${g.n} (net ${g.pnl.toFixed(2)} USD); trust it more.` });
  }
  return out;
}

export type Summarizer = (lessons: Lesson[]) => Promise<string>;
