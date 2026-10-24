import type { Db } from "./db.ts";

export type TraceKind =
  | "ingest" | "signal" | "thesis_proposed" | "guardrail" | "approval_requested" | "approval_decided"
  | "order_executed" | "position_closed" | "feedback" | "learning" | "error";

/** Records a step of the agent's reasoning for the dashboard. Never throws: tracing must not break trading. */
export async function emit(db: Db, kind: TraceKind, title: string, detail: Record<string, unknown> = {}, thesisId?: string | null, agentId?: string) {
  try {
    await db.pool.query("insert into agent_events(kind,title,detail,thesis_id,agent_id) values ($1,$2,$3,$4,$5)", [kind, title, JSON.stringify(detail), thesisId ?? null, agentId ?? null]);
  } catch {
    /* swallow */
  }
}
