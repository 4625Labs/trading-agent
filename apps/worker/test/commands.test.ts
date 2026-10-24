import test from "node:test";
import assert from "node:assert/strict";
import { demoPriceMove, overriddenPrice, priceOverrides, pollCommands } from "../src/commands.ts";

function fakeDeps(rows: Record<string, any[]>, calls: string[] = []) {
  const pool = {
    query: async (sql: string, params: any[] = []) => {
      calls.push(sql.split(" ").slice(0, 3).join(" "));
      if (/from theses/.test(sql)) return { rows: rows.theses ?? [], rowCount: (rows.theses ?? []).length };
      if (/from commands/.test(sql)) return { rows: rows.commands ?? [], rowCount: (rows.commands ?? []).length };
      if (/update commands set status='running'/.test(sql)) return { rows: [{ id: params[0] }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  return { db: { pool } as any, omnara: { send: async () => ({}) } as any, agent: () => "agt_x", llm: (async () => "") as any, price: async () => 100, walletUsd: async () => 1000, log: () => {} };
}

test("target on a long pushes price just above target; stop pushes just below stop", async () => {
  priceOverrides.clear();
  const d = fakeDeps({ theses: [{ id: "t1", asset: "BTC", direction: "long", stop: "95", target: "110" }] });
  await demoPriceMove(d, "target");
  assert.ok(overriddenPrice("BTC")! > 110);
  await demoPriceMove(d, "stop");
  assert.ok(overriddenPrice("BTC")! < 95);
});

test("short: target pushes price below target, stop above stop", async () => {
  priceOverrides.clear();
  const d = fakeDeps({ theses: [{ id: "t2", asset: "ETH", direction: "short", stop: "105", target: "90" }] });
  await demoPriceMove(d, "target");
  assert.ok(overriddenPrice("ETH")! < 90);
  await demoPriceMove(d, "stop");
  assert.ok(overriddenPrice("ETH")! > 105);
});

test("override expires and is scoped per asset", async () => {
  priceOverrides.clear();
  priceOverrides.set("BTC", { price: 1, until: Date.now() - 1 });
  assert.equal(overriddenPrice("BTC"), undefined);
  priceOverrides.set("ETH", { price: 5, until: Date.now() + 60_000 });
  assert.equal(overriddenPrice("BTC"), undefined);
  assert.equal(overriddenPrice("ETH"), 5);
});

test("no open position -> no override", async () => {
  priceOverrides.clear();
  const r = await demoPriceMove(fakeDeps({ theses: [] }), "target");
  assert.match(r, /no open position/);
  assert.equal(priceOverrides.size, 0);
});

test("unknown command kinds and bad payloads are rejected, not executed", async () => {
  priceOverrides.clear();
  const calls: string[] = [];
  const d = fakeDeps({ commands: [{ id: "c1", kind: "drop_tables", payload: {} }, { id: "c2", kind: "demo_price_move", payload: { outcome: "moon" } }] }, calls);
  await pollCommands(d);
  assert.equal(priceOverrides.size, 0);
  assert.equal(calls.filter((c) => c.startsWith("update commands set")).length >= 4, true);
});

import { feedbackCommand } from "../src/commands.ts";
import { applyFeedback } from "../src/feedback.ts";

function feedbackDb(claimed: boolean) {
  const q: string[] = [];
  const pool = {
    query: async (sql: string) => {
      q.push(sql);
      if (/update theses set feedback/.test(sql)) return claimed ? { rowCount: 1, rows: [{ asset: "BTC", direction: "short", exit_reason: "target", pnl: "3.5", size: "150" }] } : { rowCount: 0, rows: [] };
      if (/from preferences/.test(sql)) return { rows: [{ data: { allowedAssets: ["BTC"], bannedAssets: [], maxPositionPct: 0.05, approvalThresholdUsd: 25, minConfidence: 0.5 } }] };
      return { rows: [], rowCount: 1 };
    },
  };
  return { db: { pool, prefs: async () => ({ approvalThresholdUsd: 25, maxPositionPct: 0.05 }), insertLesson: async (t: string) => void q.push("lesson:" + t) } as any, q };
}

test("applyFeedback rejects labels outside the whitelist without touching the DB", async () => {
  const { db, q } = feedbackDb(true);
  assert.equal(await applyFeedback(db, "t", "Great", () => {}), false);
  assert.equal(q.length, 0);
});

test("applyFeedback records a lesson, and 'Too risky' tightens preferences", async () => {
  const { db, q } = feedbackDb(true);
  assert.equal(await applyFeedback(db, "t", "Too risky", () => {}), true);
  assert.ok(q.some((x) => x.startsWith("lesson:")));
  assert.ok(q.some((x) => /update preferences/.test(x)));
});

test("applyFeedback is a no-op when already answered or thesis not closed", async () => {
  const { db, q } = feedbackDb(false);
  assert.equal(await applyFeedback(db, "t", "Good call", () => {}), false);
  assert.ok(!q.some((x) => x.startsWith("lesson:")));
});

test("feedback command with a bad answer reports not applied", async () => {
  const { db } = feedbackDb(true);
  const d = { db, omnara: { send: async () => ({}) } as any, agent: () => "a", llm: (async () => "") as any, price: async () => 1, walletUsd: async () => 1, log: () => {} };
  assert.match(await feedbackCommand(d, { thesisId: "x", answer: "nope" }), /not applied/);
});
