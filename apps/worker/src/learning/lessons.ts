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
export const DEFAULT_LESSON_OPTS: LessonOpts = { minTrials: 8, loseRate: 0.6, winRate: 0.8 };

/** LEGACY (v1) lessons: directive wording, credits every signal on a trade regardless of agreement. Kept so earlier replays stay reproducible. */
export function lessonsFromTradesV1(trades: ClosedTrade[], o: LessonOpts = DEFAULT_LESSON_OPTS): Lesson[] {
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

/** Descriptive observation with an honest uncertainty tag. Parseable: "Observed W wins in N resolved ...". */
export function observationText(label: string, wins: number, n: number): string {
  const z = zScore(wins, n);
  const tag = wins / n < 0.5 ? `more losses than wins${z < 2 ? ", not statistically significant" : ", still a small sample"}` : z < 2 ? "not statistically significant, may be chance" : "suggestive but still a small sample";
  return `Observed ${wins} wins in ${n} resolved ${label}; ${tag}.`;
}
export function zScore(wins: number, n: number): number {
  return n ? Math.abs(wins - n / 2) / Math.sqrt(n / 4) : 0;
}

export interface Observation extends Lesson {
  n: number;
  wins: number;
  z: number;
}

/**
 * Live-path lessons: descriptive, evidence-gated and de-duplicated. Per (asset, direction) one observation listing the sources
 * that agreed with those trades; per-source observations count a source only when its signal agreed with the trade direction,
 * and sources with identical statistics collapse into one observation. Only groups with n >= minTrials. Sorted by evidence strength.
 */
export function lessonsFromTrades(trades: ClosedTrade[], o: Partial<LessonOpts> = {}): Observation[] {
  const opts = { ...DEFAULT_LESSON_OPTS, ...o };
  const label = opts.sourceLabel ?? ((id: string) => id);
  const ad = new Map<string, { asset: string; dir: string; n: number; wins: number; srcs: Set<string> }>();
  const sg = new Map<string, { n: number; wins: number }>();
  for (const t of trades) {
    if (t.pnl === 0) continue;
    const win = t.pnl > 0;
    const k = `${t.asset}:${t.direction}`;
    const a = ad.get(k) ?? { asset: t.asset, dir: t.direction, n: 0, wins: 0, srcs: new Set<string>() };
    a.n++; if (win) a.wins++;
    const agreeing = new Set(t.signals.filter((x) => x.direction === t.direction).map((x) => x.sourceId));
    for (const s of agreeing) {
      a.srcs.add(s);
      const g = sg.get(s) ?? { n: 0, wins: 0 };
      g.n++; if (win) g.wins++;
      sg.set(s, g);
    }
    ad.set(k, a);
  }
  const out: Observation[] = [];
  for (const [k, a] of ad) {
    if (a.n < opts.minTrials) continue;
    const srcs = [...a.srcs].sort().map(label);
    const base = observationText(`${a.asset} ${a.dir} trades`, a.wins, a.n);
    out.push({ key: `ad:${k}`, text: srcs.length ? base.replace(/\.$/, ` (sources that agreed: ${srcs.join(", ")}).`) : base, n: a.n, wins: a.wins, z: zScore(a.wins, a.n) });
  }
  const byStat = new Map<string, { n: number; wins: number; ids: string[] }>();
  for (const [id, g] of sg) {
    if (g.n < opts.minTrials) continue;
    const key = `${g.wins}/${g.n}`;
    const x = byStat.get(key) ?? { n: g.n, wins: g.wins, ids: [] };
    x.ids.push(id);
    byStat.set(key, x);
  }
  for (const x of byStat.values()) {
    const ids = x.ids.sort().map(label);
    out.push({ key: `src:${x.ids.sort().join("+")}`, text: observationText(`trades where ${ids.length > 1 ? "each of the sources " + ids.join(", ") : "the " + ids[0] + " source"} agreed with the trade direction`, x.wins, x.n), n: x.n, wins: x.wins, z: zScore(x.wins, x.n) });
  }
  return out.sort((a, b) => b.z - a.z || a.key.localeCompare(b.key));
}

const OBS_RE = /Observed (\d+) wins in (\d+) resolved/;
/** Pick prompt-ready observations from stored learner lesson texts: parseable, n >= minN, ranked by evidence, capped. Legacy directive rows are dropped. */
export function topObservations(texts: string[], minN = 8, cap = 3): string[] {
  return texts
    .map((t) => { const m = OBS_RE.exec(t); return m ? { t, n: +m[2], z: zScore(+m[1], +m[2]) } : null; })
    .filter((x): x is { t: string; n: number; z: number } => !!x && x.n >= minN)
    .sort((a, b) => b.z - a.z || a.t.localeCompare(b.t))
    .filter((x, i, arr) => arr.findIndex((y) => y.t === x.t) === i)
    .slice(0, cap)
    .map((x) => x.t);
}
