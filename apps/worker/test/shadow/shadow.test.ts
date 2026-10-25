import test from "node:test";
import assert from "node:assert/strict";
import { decide, buildShadowVerdict, maxDrawdownOf, zOfDiffs, runShadowCycle, updateShadowOutcomes, shadowSummary } from "../../src/shadow.ts";

test("decide: threshold, weights flip the outcome, votes recorded", () => {
  const sigs = [
    { asset: "T", source: "good", direction: "long" as const, confidence: 0.6 },
    { asset: "T", source: "bad", direction: "short" as const, confidence: 0.7 },
  ];
  assert.equal(decide(sigs, {}), null);
  const l = decide(sigs, { good: 2, bad: 0.3 })!;
  assert.equal(l.direction, "long"); assert.ok(l.votes.good > 0 && l.votes.bad < 0);
});
test("verdict honesty", () => {
  assert.match(buildShadowVerdict({ learnedClosed: 5, equalClosed: 30, delta: 9, z: 5, buckets: 4 }), /Not enough closed trades yet/);
  const noisy = buildShadowVerdict({ learnedClosed: 30, equalClosed: 30, delta: 1, z: 0.8, buckets: 10 });
  assert.match(noisy, /within its own noise/); assert.doesNotMatch(noisy, /helps\.|improv/);
  assert.match(buildShadowVerdict({ learnedClosed: 30, equalClosed: 30, delta: 2, z: 3, buckets: 10 }), /beyond noise/);
});
test("maxDrawdown and z helpers", () => {
  assert.equal(maxDrawdownOf([5, -3, -4, 10]), 7);
  assert.equal(zOfDiffs([1]), 0); assert.ok(zOfDiffs([1, 2, 3, 2]) > 2);
});

// DB tests in a rolled-back transaction, using a fake asset "TST" so live rows never interfere.
const trending = Array.from({ length: 120 }, (_, i) => { const c = 100 + i; return { t: i, o: c, h: c + 1, l: c - 1, c }; });
async function withTx(fn: (c: any) => Promise<void>) {
  const { Db } = await import("../../src/db.ts");
  const db = Db.fromEnv(); const c = await db.pool.connect();
  try { await c.query("begin"); await fn(c); } finally { await c.query("rollback"); c.release(); await db.close(); }
}
const skip = !process.env.DATABASE_URL;

test("cycle opens for both policies, respects open position; outcomes close, claim once, update learned weights only", { skip }, async () => {
  await withTx(async (c) => {
    const t0 = new Date();
    const base = { pool: c, assets: ["TST"], price: async () => 100, candles: async () => trending, newsSignals: async () => [], now: () => t0 };
    await c.query("delete from shadow_weights"); // inside the rolled-back transaction only
    await c.query("insert into shadow_weights(source,weight) values ('technical:momentum',3)");
    const r1 = await runShadowCycle(base);
    assert.deepEqual(r1.opened, { learned: 1, equal: 1 });
    const r2 = await runShadowCycle(base);
    assert.deepEqual(r2.opened, { learned: 0, equal: 0 }); // open position exists
    const rows = (await c.query("select * from shadow_trades where asset='TST'")).rows;
    assert.equal(rows.length, 2); assert.ok(Object.keys(rows[0].votes).length > 0);
    // price jumps +5%: long trades hit target
    const dir = (p: string) => rows.find((r: any) => r.policy === p).direction;
    assert.equal(dir("learned"), "long"); assert.equal(dir("equal"), "short"); // same signals, different weights
    const px = 105;
    const o1 = await updateShadowOutcomes({ pool: c, price: async () => px, now: () => new Date(t0.getTime() + 60_000) });
    assert.equal(o1.closed, 2);
    const o2 = await updateShadowOutcomes({ pool: c, price: async () => px });
    assert.equal(o2.closed, 0); // idempotent
    const closed = (await c.query("select policy,exit_reason,pnl from shadow_trades where asset='TST'")).rows;
    const by = (p: string) => closed.find((r: any) => r.policy === p);
    assert.equal(by("learned").exit_reason, "target"); assert.ok(+by("learned").pnl > 0);
    assert.equal(by("equal").exit_reason, "stop"); assert.ok(+by("equal").pnl < 0);
    const w = (await c.query("select weight, trials from shadow_weights where source='technical:momentum'")).rows[0];
    assert.equal(w.trials, 1); assert.ok(+w.weight !== 3); // learned only: one trial, not two
    const s = await shadowSummary(c);
    assert.ok(s.policies.learned.closed >= 1 && s.policies.equal.closed >= 1);
    assert.match(s.verdict, /Not enough closed trades yet|rough/);
  });
});
test("timeout close", { skip }, async () => {
  await withTx(async (c) => {
    const t0 = new Date();
    await runShadowCycle({ pool: c, assets: ["TST"], price: async () => 100, candles: async () => trending, newsSignals: async () => [], now: () => t0 });
    const o = await updateShadowOutcomes({ pool: c, price: async () => 100.1, now: () => new Date(t0.getTime() + 13 * 3600_000) });
    assert.ok(o.closed >= 2);
    assert.ok((await c.query("select 1 from shadow_trades where asset='TST' and exit_reason='timeout'")).rowCount! >= 2);
  });
});
