import type { Db } from "./db.ts";
import type { Omnara } from "./omnara.ts";
import type { LlmFn } from "./ingest/llm.ts";
import { generateTheses, pgThesisReaders, proposeToAgent } from "./thesis/index.ts";
import { emit } from "./trace.ts";
import { applyFeedback } from "./feedback.ts";
import { runLearningCycle } from "./learning/cycle.ts";

/** Demo price overrides apply ONLY to the close-out watcher, never to fills, guardrails or real orders. */
export const priceOverrides = new Map<string, { price: number; until: number }>();

export function overriddenPrice(asset: string): number | undefined {
  const o = priceOverrides.get(asset);
  if (!o) return undefined;
  if (Date.now() > o.until) {
    priceOverrides.delete(asset);
    return undefined;
  }
  return o.price;
}

export interface CommandDeps {
  db: Db;
  omnara: Pick<Omnara, "send">;
  agent: () => string | undefined;
  llm: LlmFn;
  price: (asset: string) => Promise<number>;
  walletUsd: () => Promise<number>;
  log: (s: string) => void;
}

/** Demo idea: runs the real news -> thesis pipeline with a lower confidence bar, then hands it to the agent. */
export async function demoIdea(d: CommandDeps): Promise<string> {
  const a = d.agent();
  if (!a) return "no active agent";
  const readers = pgThesisReaders(d.db);
  const theses = await generateTheses({
    ...readers,
    prefs: async () => ({ ...(await readers.prefs()), minConfidence: 0.2 }),
    llm: d.llm,
    price: d.price,
    walletUsd: Math.min(await d.walletUsd(), 5_000),
    log: d.log,
  });
  if (!theses.length) return "no idea could be formed from the current news signals";
  const t = theses.find((x) => x.direction === "long") ?? theses[0];
  await emit(
    d.db,
    "thesis_proposed",
    `Idea (demo request): ${t.direction} ${t.asset} $${t.size}. Why: ${t.rationale}`,
    { demo: true, asset: t.asset, direction: t.direction, size: t.size, entry: t.entry, stop: t.stop, target: t.target, confidence: t.confidence, rationale: t.rationale, venueHint: t.venueHint, signalIds: t.signalIds },
    null,
    a,
  );
  await proposeToAgent(d.omnara, a, t);
  return `proposed ${t.direction} ${t.asset} $${t.size} to the agent`;
}

/** Demo price move: pushes the watched price just past the target or stop of the latest open position, for 90s. */
export async function demoPriceMove(d: CommandDeps, outcome: "target" | "stop"): Promise<string> {
  const r = await d.db.pool.query("select id,asset,direction,stop,target from theses where status='executed' order by created_at desc limit 1");
  const t = r.rows[0];
  if (!t) return "no open position to move";
  const long = t.direction === "long";
  const level = +(outcome === "target" ? t.target : t.stop);
  // long target or short stop -> price goes up; long stop or short target -> price goes down
  const beyond = (outcome === "target") === long ? 1.002 : 0.998;
  const price = level * beyond;
  priceOverrides.set(t.asset, { price, until: Date.now() + 90_000 });
  await emit(d.db, "demo", `Demo: simulated ${t.asset} price move to ${price.toFixed(2)} to trigger the ${outcome}. This is not a real market move.`, { demo: true, outcome, price, asset: t.asset }, t.id);
  return `simulating ${t.asset} at ${price.toFixed(2)} (${outcome}); the watcher closes it within ~15s`;
}

/** Human feedback entered in the dashboard: applied directly, no agent round trip. */
export async function feedbackCommand(d: CommandDeps, payload: { thesisId?: string; answer?: string }): Promise<string> {
  const ok = await applyFeedback(d.db, String(payload?.thesisId ?? ""), String(payload?.answer ?? ""), d.log);
  if (!ok) return "feedback not applied (thesis not closed, already has feedback, or invalid answer)";
  await emit(d.db, "feedback", `You said: ${payload.answer}`, { answer: payload.answer, via: "dashboard" }, String(payload.thesisId));
  const l = await runLearningCycle({ pool: d.db.pool, log: d.log });
  if (l.trades > 0) await emit(d.db, "learning", `Learning update from ${l.trades} closed trades: ${l.lessonsWritten} lessons`, { closedTrades: l.trades, lessons: l.lessonsWritten, brier: l.brier, weights: l.weights });
  return `recorded "${payload.answer}" and updated what the agent has learned`;
}

/** Claim and run pending commands from the dashboard. Each command is claimed atomically. */
export async function pollCommands(d: CommandDeps) {
  const pending = await d.db.pool.query("select id,kind,payload from commands where status='pending' order by created_at limit 5");
  for (const c of pending.rows) {
    const claim = await d.db.pool.query("update commands set status='running' where id=$1 and status='pending' returning id", [c.id]);
    if (!claim.rowCount) continue;
    let status = "done";
    let result: string;
    try {
      if (c.kind === "demo_idea") result = await demoIdea(d);
      else if (c.kind === "demo_price_move" && (c.payload?.outcome === "target" || c.payload?.outcome === "stop")) result = await demoPriceMove(d, c.payload.outcome);
      else if (c.kind === "feedback") result = await feedbackCommand(d, c.payload);
      else {
        status = "failed";
        result = `unknown command ${c.kind}`;
      }
    } catch (e) {
      status = "failed";
      result = (e as Error).message.slice(0, 200);
    }
    await d.db.pool.query("update commands set status=$2, result=$3, done_at=now() where id=$1", [c.id, status, result]);
    d.log(`command ${c.kind}: ${status} - ${result}`);
  }
}
