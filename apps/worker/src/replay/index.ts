import { readFileSync } from "node:fs";
import { parseKlines, type Candle } from "../learning/replay.ts";
import { sourceStats } from "../learning/stats.ts";
import { MODEL_THESIS, parseJsonLoose, type LlmFn } from "../ingest/llm.ts";
import type { Queryable } from "../learning/types.ts";
import { ASSETS, maxDrawdown, runEngine, type ArmName, type ArmResult, type CycleRow, type Decision, type LlmDecider, type LessonStyle } from "./engine.ts";
import { PLANTED, clamp } from "./sources.ts";

export * from "./sources.ts";
export { runEngine, maxDrawdown, WARMUP, lessonsV2 } from "./engine.ts";
export type { LessonStyle } from "./engine.ts";
export type { LlmFn };

export const DISCLAIMER = "Replay on historical prices, not live trading; planted sources are synthetic; past performance does not predict future results.";
export const LLM_CALL_BUDGET = 260;

export function loadFixtureKlines(): Record<string, Candle[]> {
  const out: Record<string, Candle[]> = {};
  for (const a of ASSETS) out[a] = parseKlines(JSON.parse(readFileSync(new URL(`../../test/fixtures/klines-4h-${a}.json`, import.meta.url), "utf8")));
  return out;
}

/** Validate a model decision: allowed assets only, one trade per asset, max 3, size clamped to 10..200 USD. */
export function validateDecisions(raw: unknown): Decision[] {
  const arr = Array.isArray((raw as any)?.trades) ? (raw as any).trades : [];
  const seen = new Set<string>();
  const out: Decision[] = [];
  for (const t of arr) {
    const asset = String(t?.asset ?? "").toUpperCase();
    const direction = String(t?.direction ?? "").toLowerCase();
    const size = Number(t?.size), confidence = Number(t?.confidence);
    if (!ASSETS.includes(asset) || seen.has(asset) || (direction !== "long" && direction !== "short") || !Number.isFinite(size) || !Number.isFinite(confidence)) continue;
    seen.add(asset);
    out.push({ asset, direction, size: clamp(size, 10, 200), confidence: clamp(confidence, 0, 1) });
    if (out.length >= 3) break;
  }
  return out;
}

const LLM_SYSTEM = `You are the decision desk of a cautious crypto trading agent in a historical replay. You see ONLY structured signals. Respond with ONLY a JSON object, no prose:
{"trades":[{"asset":"BTC|ETH|SOL","direction":"long|short","size":<USD 10-200>,"confidence":<0..1>}]}
At most one trade per asset, at most 3 trades. An empty list is fine. Each trade exits at -2% stop, +4% target, or after 12 cycles. Use each source's running hit rate (if shown) to decide whom to trust.`;
const V3_EXTRA = ` Do not increase size or trade count because of these observations.`;
const V2_NOTE = `\n\nNote on lessons: they are weak, noisy evidence from small samples. They do not change the exit rules or your position sizing. Keep trading only when several signals agree, and prefer no trade when unsure.`;

export function llmDecider(llm: LlmFn, timeoutMs = 60_000, log?: (s: string) => void): LlmDecider {
  return async (arm, ctx) => {
    const byAsset = ASSETS.map((a) => ({
      asset: a, price: Math.round(ctx.prices[a] * 100) / 100,
      signals: ctx.signals.filter((s) => s.asset === a).map((s) => ({ source: s.source, direction: s.direction, confidence: +s.confidence.toFixed(2), running_hit_rate: ctx.hitRates[s.source] ? { rate: +ctx.hitRates[s.source].rate.toFixed(2), trials: ctx.hitRates[s.source].trials } : null })),
    }));
    let prompt = `Signals this cycle:\n${JSON.stringify(byAsset)}`;
    if (arm === "llm_lessons") prompt += `\n\n${ctx.lessonStyle === "v2" || ctx.lessonStyle === "v3" ? "Observations so far" : "Lessons learned so far"}:\n${ctx.lessons.length ? ctx.lessons.map((l) => "- " + l).join("\n") : "(none yet)"}${ctx.lessonStyle === "v2" ? V2_NOTE : ctx.lessonStyle === "v3" ? V2_NOTE + V3_EXTRA : ""}`;
    try {
      const text = await Promise.race([
        llm({ model: MODEL_THESIS, system: LLM_SYSTEM, prompt, maxTokens: ctx.lessonStyle === "v2" || ctx.lessonStyle === "v3" ? 800 : 400 }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("llm timeout")), timeoutMs)),
      ]);
      return { decisions: validateDecisions(parseJsonLoose(text)), raw: text, lessons: ctx.lessons };
    } catch (e) {
      log?.(`${arm} llm call failed: ${(e as Error).message}`);
      return null;
    }
  };
}

export interface Replay100Deps {
  pool: Queryable | null;
  cycles?: number;
  seed?: number;
  llm?: LlmFn | null;
  log?: (s: string) => void;
  onProgress?: (n: number) => void;
  runId?: string;
  klines?: Record<string, Candle[]>;
  llmFrom?: number; // LLM arms start at this 1-based cycle (diagnostics)
  lessonStyle?: LessonStyle; // 'v1' (default, original) | 'v2' (evidence-gated descriptive) | 'v3' (v2 + explicit no size/trade-count increase)
}

function armSummary(r: ArmResult) {
  const h = Math.floor(r.cum.length / 2);
  const sum = (xs: number[], a: number, b: number) => xs.slice(a, b).reduce((s, x) => s + x, 0);
  const rate = (a: number, b: number) => { const n = sum(r.cycleTrades, a, b); return n ? sum(r.cycleWins, a, b) / n : null; };
  return {
    finalPnl: r.cum[r.cum.length - 1] ?? 0, trades: r.resolved.length, hitRate: rate(0, r.cum.length),
    firstHalfPnl: sum(r.cyclePnl, 0, h), secondHalfPnl: sum(r.cyclePnl, h, r.cum.length),
    firstHalfHit: rate(0, h), secondHalfHit: rate(h, r.cum.length), maxDrawdown: maxDrawdown(r.cum),
  };
}

/** z-score of the mean per-cycle pnl difference (a rough noise check, not a formal test). */
function deltaZ(a: number[], b: number[]) {
  const d = a.map((x, i) => x - b[i]);
  const m = d.reduce((s, x) => s + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, d.length - 1));
  return sd > 0 ? m / (sd / Math.sqrt(d.length)) : 0;
}

const f = (x: number | null | undefined, d = 2) => (x == null ? "n/a" : x.toFixed(d));

export function buildVerdict(s: { learnerVsBaseline: { all: { delta: number; z: number }; technicalOnly: { delta: number; z: number } }; arms: Record<string, ReturnType<typeof armSummary>>; plantedRankingCorrect: boolean; llm?: { lessonsVsNoLessons: number } }): string {
  const parts: string[] = [];
  const word = (x: { delta: number; z: number }) => (Math.abs(x.z) < 2 ? `${x.delta >= 0 ? "ahead by" : "behind by"} ${f(Math.abs(x.delta))} USD, which is NOT statistically distinguishable from noise (z=${f(x.z)})` : x.delta > 0 ? `ahead by ${f(x.delta)} USD (z=${f(x.z)})` : `BEHIND by ${f(-x.delta)} USD (z=${f(x.z)})`);
  parts.push(`With all sources (planted + technical), the learner finished ${word(s.learnerVsBaseline.all)} versus the fixed-weight baseline.`);
  parts.push(`On the real technical sources alone, the learner finished ${word(s.learnerVsBaseline.technicalOnly)}${s.learnerVsBaseline.technicalOnly.delta <= 0 || Math.abs(s.learnerVsBaseline.technicalOnly.z) < 2 ? "; we cannot claim the learner beats the baseline on real technical signals" : ""}.`);
  parts.push(s.plantedRankingCorrect ? "The learner recovered the planted ranking (good > random > contrarian), which shows the learning mechanism works when a real edge exists." : "The learner did NOT fully recover the planted source ranking in this run.");
  const l = s.arms.learner;
  parts.push(`Learner hit rate went from ${f(l.firstHalfHit)} (first half) to ${f(l.secondHalfHit)} (second half); PnL ${f(l.firstHalfPnl)} -> ${f(l.secondHalfPnl)} USD. A single path over ~100 cycles is a small sample.`);
  if (s.llm) parts.push(`LLM arm with lessons minus without lessons: ${f(s.llm.lessonsVsNoLessons)} USD (single run, high variance).`);
  return parts.join(" ");
}

/** Runs the 100-cycle walk-forward replay, persists replay_runs/replay_cycles (when a pool is given) and returns the summary. */
export async function runReplay100(deps: Replay100Deps) {
  const cycles = deps.cycles ?? 100, seed = deps.seed ?? 42, log = deps.log ?? (() => {});
  const klines = deps.klines ?? loadFixtureKlines();
  const pool = deps.pool;
  const arms: ArmName[] = deps.llm ? ["learner", "baseline", "llm_lessons", "llm_nolessons"] : ["learner", "baseline"];
  let runId = deps.runId ?? "";
  const params = { seed, cycles, llm: !!deps.llm, lessonStyle: deps.lessonStyle ?? "v1", llmFrom: deps.llmFrom ?? 1, candles: "4h", stopPct: 0.02, targetPct: 0.04, maxHold: 12, sources: [...Object.keys(PLANTED), "momentum", "meanrev", "breakout", "volregime"] };
  if (pool) {
    if (runId) await pool.query("insert into replay_runs(id,params) values ($1,$2)", [runId, params]);
    else runId = (await pool.query("insert into replay_runs(params) values ($1) returning id", [params])).rows[0].id;
  }
  try {
    const main = await runEngine({
      cycles, seed, klines, sources: "all", arms, lessonStyle: deps.lessonStyle, llmFrom: deps.llmFrom, llm: deps.llm ? llmDecider(deps.llm, 60_000, log) : null, log,
      onCycle: async (rows: CycleRow[], n) => {
        if (pool) {
          for (const r of rows) {
            await pool.query(
              "insert into replay_cycles(run_id,n,arm,sim_ts,trades,pnl,cum_pnl,hit_rate_20,brier,weights,lessons,detail) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
              [runId, r.n, r.arm, r.simTs, r.trades, r.pnl, r.cumPnl, r.hitRate20, r.brier, r.weights, r.lessons, r.detail],
            );
          }
          if (n % 5 === 0) await pool.query("update replay_runs set progress=$2 where id=$1", [runId, n]);
        }
        deps.onProgress?.(n);
      },
    });
    const tech = await runEngine({ cycles, seed, klines, sources: "technical", arms: ["learner", "baseline"] });

    const armsSummary: Record<string, ReturnType<typeof armSummary>> = {};
    for (const a of arms) armsSummary[a] = armSummary(main[a]);
    const L = main.learner, B = main.baseline;
    const stats = sourceStats(L.resolved);
    const ranking = Object.entries(L.weights).map(([source, weight]) => ({
      source, kind: source in PLANTED ? "planted" : "technical", plantedHitRate: PLANTED[source] ?? null, learnedWeight: +weight.toFixed(3),
      observedHitRate: stats[source] ? +stats[source].hitRate.toFixed(3) : null, trials: stats[source]?.trials ?? 0,
    })).sort((a, b) => b.learnedWeight - a.learnedWeight);
    const w = L.weights;
    const plantedRankingCorrect = w.planted_good > w.planted_random && w.planted_random > w.planted_contrarian;
    const learnerVsBaseline = {
      all: { delta: L.cum[L.cum.length - 1] - B.cum[B.cum.length - 1], z: deltaZ(L.cyclePnl, B.cyclePnl) },
      technicalOnly: { delta: tech.learner.cum.at(-1)! - tech.baseline.cum.at(-1)!, z: deltaZ(tech.learner.cyclePnl, tech.baseline.cyclePnl), learnerPnl: tech.learner.cum.at(-1)!, baselinePnl: tech.baseline.cum.at(-1)! },
    };
    const llmPart = deps.llm ? { lessonsVsNoLessons: armsSummary.llm_lessons.finalPnl - armsSummary.llm_nolessons.finalPnl, calls: main.llmCalls, skippedCycles: main.skippedLlm } : undefined;
    const summary = {
      arms: armsSummary, sourceRanking: ranking, plantedRankingCorrect, learnerVsBaseline, llm: llmPart,
      verdict: buildVerdict({ learnerVsBaseline, arms: armsSummary, plantedRankingCorrect, llm: llmPart }),
      disclaimer: DISCLAIMER,
    };
    if (pool) await pool.query("update replay_runs set status='done', finished_at=now(), progress=$2, summary=$3 where id=$1", [runId, cycles, summary]);
    return { runId, params, summary, series: Object.fromEntries(arms.map((a) => [a, main[a].cum])) as Record<string, number[]> };
  } catch (e) {
    const msg = String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>").slice(0, 300);
    if (pool) await pool.query("update replay_runs set status='failed', finished_at=now(), error=$2 where id=$1", [runId, msg]).catch(() => {});
    throw e;
  }
}
