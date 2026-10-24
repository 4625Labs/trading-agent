import test from "node:test";
import assert from "node:assert/strict";
import { positionFromRow, realPnl } from "../src/watcher.ts";
import { Simulator } from "../src/simulator.ts";
import { outcomeLine, feedbackPrompt, syncFeedback, askPendingFeedback } from "../src/feedback.ts";

const row = { id: "t1", asset: "BTC", direction: "long" as const, entry: "100", size: "100", stop: "95", target: "110", rationale: null, confidence: 0.7, signal_ids: null, fill_price: "100.05", qty: "0.9995", fee: "0.1" };

test("rehydrated position closes at target via Simulator semantics", () => {
  const sim = new Simulator(async () => 100);
  sim.positions.set("t1", positionFromRow(row));
  assert.equal(sim.markToMarket({ BTC: 105 }).length, 0);
  const c = sim.markToMarket({ BTC: 111 });
  assert.equal(c[0].exitReason, "target");
  assert.ok(c[0].pnl! > 0);
});
test("realPnl nets fees", () => {
  assert.ok(Math.abs(realPnl({ fillPrice: 100, fee: 0.1 }, { fillPrice: 110, qty: 1, fee: 0.1 }) - 9.8) < 1e-9);
});
test("feedback prompt format", () => {
  const o = outcomeLine({ asset: "SOL", direction: "long", exit_reason: "stop", pnl: "-2.5", size: 100 });
  assert.equal(o, "SOL long closed at stop: -$2.50 (-2.5%)");
  assert.equal(feedbackPrompt("abc", o), "Feedback on thesis abc? " + o);
});

const uuid = "11111111-2222-3333-4444-555555555555";
function fakeDb() {
  const calls: { sql: string; p?: unknown[] }[] = [];
  let claimed = false;
  const db: any = {
    calls,
    pool: { query: async (sql: string, p?: unknown[]) => {
      calls.push({ sql, p });
      if (/update theses set feedback=/.test(sql)) { if (claimed) return { rowCount: 0, rows: [] }; claimed = true; return { rowCount: 1, rows: [{ asset: "SOL", direction: "long", exit_reason: "stop", pnl: -2, size: 100 }] }; }
      if (/update preferences/.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    } },
    prefs: async () => ({ approvalThresholdUsd: 25, maxPositionPct: 0.05 }),
    insertLesson: async (t: string, o: string) => { calls.push({ sql: "lesson", p: [t, o] }); },
  };
  return db;
}
test("syncFeedback writes lesson, tightens prefs on Too risky, is idempotent", async () => {
  const db = fakeDb();
  const it = { id: "i1", interaction_kind: "question", state: "resolved", answers: [{ option_indices: [2] }], request: { questions: [{ prompt: `Feedback on thesis ${uuid}? SOL long closed at stop`, options: [{ label: "Good call" }, { label: "Bad call" }, { label: "Too risky" }] }] } };
  const omnara: any = { interactions: async () => [it] };
  assert.equal(await syncFeedback(db, omnara, "a"), 1);
  assert.equal(await syncFeedback(db, omnara, "a"), 0);
  const lesson = db.calls.find((c: any) => c.sql === "lesson");
  assert.equal(lesson.p[1], "human_feedback");
  const pref = db.calls.find((c: any) => /update preferences/.test(c.sql));
  assert.equal((pref.p[1] as any).approvalThresholdUsd, 20);
  assert.ok((pref.p[1] as any).maxPositionPct < 0.05);
});
test("askPendingFeedback sends the exact prompt", async () => {
  const sent: string[] = [];
  const db: any = { pool: { query: async (sql: string) => /^select/.test(sql) ? { rows: [{ id: uuid, asset: "SOL", direction: "long", exit_reason: "target", pnl: 3, size: 100 }] } : { rowCount: 1, rows: [] } } };
  const n = await askPendingFeedback(db, { send: async (_a: string, t: string) => { sent.push(t); } } as any, "agent");
  assert.equal(n, 1);
  assert.ok(sent[0].includes(`"Feedback on thesis ${uuid}? SOL long closed at target: +$3.00 (+3.0%)"`));
  assert.ok(sent[0].includes('"Good call", "Bad call", "Too risky"'));
});
