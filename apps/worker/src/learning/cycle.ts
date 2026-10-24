import { sourceStats } from "./stats.ts";
import { updateSourceWeights, DEFAULT_WEIGHT_OPTS, type WeightOpts } from "./weights.ts";
import { fitCalibration, type CalibrationModel } from "./calibration.ts";
import { lessonsFromTrades, DEFAULT_LESSON_OPTS, type LessonOpts, type Summarizer } from "./lessons.ts";
import type { ClosedTrade, Queryable } from "./types.ts";

export interface CycleDeps {
  pool: Queryable;
  weightOpts?: WeightOpts;
  lessonOpts?: Partial<LessonOpts>;
  summarizer?: Summarizer; // optional LLM summary; default off
  log?: (s: string) => void;
}
export interface CycleResult {
  trades: number;
  weights: Record<string, number>;
  lessonsWritten: number;
  brier: number;
}

/** Closed trades (synthetic pnl preferred, else real) with their backing signals. */
export async function loadClosedTrades(pool: Queryable): Promise<{ trades: ClosedTrade[]; labels: Record<string, string> }> {
  const th = await pool.query(
    `select t.id, t.asset, t.direction, t.confidence, t.closed_at, t.signal_ids,
            coalesce(st.pnl, rt.pnl, t.pnl) as pnl
       from theses t
       left join lateral (select sum(pnl) pnl from synthetic_trades where thesis_id=t.id and pnl is not null) st on true
       left join lateral (select sum(pnl) pnl from real_trades where thesis_id=t.id and pnl is not null) rt on true
      where t.status='closed' and coalesce(st.pnl, rt.pnl, t.pnl) is not null
      order by t.closed_at nulls last, t.created_at`,
  );
  const ids = [...new Set(th.rows.flatMap((r) => (r.signal_ids ?? []) as string[]))];
  const sigs = new Map<string, { sourceId: string; direction: "long" | "short"; confidence: number }>();
  const labels: Record<string, string> = {};
  if (ids.length) {
    const s = await pool.query("select s.id, s.direction, s.confidence, s.source_id, so.url as src_url from signals s left join sources so on so.id=s.source_id where s.id = any($1::uuid[])", [ids]);
    for (const r of s.rows) {
      if (!r.source_id) continue;
      sigs.set(r.id, { sourceId: r.source_id, direction: r.direction, confidence: +r.confidence });
      labels[r.source_id] = r.src_url ?? r.source_id;
    }
  }
  const trades: ClosedTrade[] = th.rows.map((r) => ({
    thesisId: r.id, asset: r.asset, direction: r.direction, confidence: +r.confidence, pnl: +r.pnl,
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : undefined,
    signals: ((r.signal_ids ?? []) as string[]).map((i) => sigs.get(i)).filter((x): x is NonNullable<typeof x> => !!x),
  }));
  return { trades, labels };
}

export async function loadCalibration(pool: Queryable): Promise<CalibrationModel | null> {
  const r = await pool.query("select n, brier, base_rate, bins from calibration order by created_at desc limit 1");
  const x = r.rows[0];
  return x ? { n: x.n, brier: +x.brier, baseRate: +x.base_rate, bins: x.bins } : null;
}

/** Recompute per-source stats from full history, update weights, calibration and lessons. Idempotent on unchanged data except EMA drift toward targets. */
export async function runLearningCycle(d: CycleDeps): Promise<CycleResult> {
  const log = d.log ?? (() => {});
  const { trades, labels } = await loadClosedTrades(d.pool);
  const stats = sourceStats(trades);
  const prevRows = await d.pool.query("select id, weight from sources");
  const prev: Record<string, number> = {};
  for (const r of prevRows.rows) prev[r.id] = +r.weight;
  const next = updateSourceWeights(prev, stats, d.weightOpts ?? DEFAULT_WEIGHT_OPTS);
  for (const [id, w] of Object.entries(next)) {
    if (!(id in prev)) continue;
    const s = stats[id];
    await d.pool.query("update sources set weight=$2, hits=$3, trials=$4, pnl_sum=$5, updated_at=now() where id=$1", [id, w, s?.hits ?? 0, s?.trials ?? 0, s?.totalPnl ?? 0]);
  }

  const model = fitCalibration(trades.filter((t) => t.pnl !== 0).map((t) => ({ confidence: t.confidence, outcome: (t.pnl > 0 ? 1 : 0) as 0 | 1 })));
  const last = await loadCalibration(d.pool);
  if (model.n > 0 && last?.n !== model.n) {
    await d.pool.query("insert into calibration(n,brier,base_rate,bins) values ($1,$2,$3,$4)", [model.n, model.brier, model.baseRate, JSON.stringify(model.bins)]);
  }

  const lessons = lessonsFromTrades(trades, { ...DEFAULT_LESSON_OPTS, ...d.lessonOpts, sourceLabel: (id) => labels[id] ?? id });
  // drop stale learner lessons (including legacy directive ones) that are no longer supported
  await d.pool.query("delete from lessons where origin='learner' and (key is null or key <> all($1::text[]))", [lessons.map((l) => l.key)]);
  for (const l of lessons) {
    await d.pool.query("insert into lessons(text,origin,key) values ($1,'learner',$2) on conflict (key) do update set text=excluded.text, created_at=now()", [l.text, l.key]);
  }
  if (d.summarizer && lessons.length) {
    const text = await d.summarizer(lessons).catch(() => "");
    if (text) await d.pool.query("insert into lessons(text,origin,key) values ($1,'learner_llm','summary') on conflict (key) do update set text=excluded.text", [text]);
  }
  log(`learning: ${trades.length} closed trades, ${Object.keys(stats).length} sources, ${lessons.length} lessons, brier ${model.brier.toFixed(3)}`);
  return { trades: trades.length, weights: next, lessonsWritten: lessons.length, brier: model.brier };
}
