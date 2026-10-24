import type { Db } from "./db.ts";
import type { Omnara } from "./omnara.ts";
import { chosenIndex } from "./loop.ts";

export const FEEDBACK_OPTIONS = ["Good call", "Bad call", "Too risky"] as const;
const FB_RE = /^Feedback on thesis\s+([0-9a-f]{8}-[0-9a-f-]{27})\?/i;

export function outcomeLine(t: { asset: string; direction: string; exit_reason: string | null; pnl: number | string | null; size: number | string }): string {
  const pnl = Number(t.pnl ?? 0);
  const pct = Number(t.size) ? (pnl / Number(t.size)) * 100 : 0;
  return `${t.asset} ${t.direction} closed at ${t.exit_reason ?? "exit"}: ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
}

export function feedbackPrompt(id: string, outcome: string) {
  return `Feedback on thesis ${id}? ${outcome}`;
}

/** Ask the human (via the Omnara agent) about closed theses not yet asked. Claims the row first so a crash never double-asks. */
export async function askPendingFeedback(db: Db, omnara: Omnara, agent: string, opts: { max?: number; log?: (s: string) => void } = {}): Promise<number> {
  const rows = (await db.pool.query(
    "select id,asset,direction,exit_reason,pnl,size from theses where status='closed' and feedback_asked_at is null order by closed_at limit $1",
    [opts.max ?? 1],
  )).rows;
  let asked = 0;
  for (const t of rows) {
    const claim = await db.pool.query("update theses set feedback_asked_at=now() where id=$1 and feedback_asked_at is null returning id", [t.id]);
    if (!claim.rowCount) continue;
    const prompt = feedbackPrompt(t.id, outcomeLine(t));
    try {
      await omnara.send(agent, `A trade just closed. Call ask_question now with the prompt exactly "${prompt}" and options ${FEEDBACK_OPTIONS.map((o) => `"${o}"`).join(", ")}. Do nothing else.`);
      asked++;
      opts.log?.(`asked feedback for thesis ${t.id}`);
    } catch (e) {
      await db.pool.query("update theses set feedback_asked_at=null where id=$1", [t.id]);
      opts.log?.(`feedback ask failed: ${(e as Error).message}`);
    }
  }
  return asked;
}

/** Lower risk limits after a "Too risky" verdict (x0.8, with floors). */
export async function tightenPrefs(db: Db, userId = "default") {
  const p = await db.prefs(userId);
  const next = { ...p, approvalThresholdUsd: Math.max(5, +(p.approvalThresholdUsd * 0.8).toFixed(2)), maxPositionPct: Math.max(0.005, +(p.maxPositionPct * 0.8).toFixed(4)) };
  await db.pool.query("update preferences set data=$2, updated_at=now() where user_id=$1", [userId, next]);
  return next;
}

/** Turn resolved feedback questions into lessons and preference changes. Idempotent per thesis. */
export async function syncFeedback(db: Db, omnara: Omnara, agent: string, opts: { log?: (s: string) => void } = {}): Promise<number> {
  let n = 0;
  for (const it of await omnara.interactions(agent, "resolved")) {
    if (it.interaction_kind !== "question") continue;
    const q = it.request?.questions?.[0];
    const m = FB_RE.exec(q?.prompt ?? "");
    if (!m) continue;
    const idx = chosenIndex(it);
    const label = idx === undefined ? undefined : q?.options[idx]?.label;
    if (!label) continue;
    const claim = await db.pool.query("update theses set feedback=$2, feedback_at=now() where id=$1 and feedback is null returning asset,direction,exit_reason,pnl,size", [m[1], label]);
    if (!claim.rowCount) continue;
    const t = claim.rows[0];
    await db.insertLesson(`Human feedback "${label}" on ${outcomeLine(t)}.`, "human_feedback");
    if (/too risky/i.test(label)) {
      const p = await tightenPrefs(db);
      opts.log?.(`"Too risky": approvalThresholdUsd=${p.approvalThresholdUsd} maxPositionPct=${p.maxPositionPct}`);
    }
    opts.log?.(`feedback on ${m[1]}: ${label}`);
    n++;
  }
  return n;
}
