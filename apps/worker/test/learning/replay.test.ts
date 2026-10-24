import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseKlines, runReplay } from "../../src/learning/replay.ts";

const load = (a: string) => parseKlines(JSON.parse(readFileSync(new URL(`../fixtures/klines-${a}.json`, import.meta.url), "utf8")));
const klines = { BTC: load("BTC"), ETH: load("ETH"), SOL: load("SOL") };

test("planted truth: learner ranks A > B > C and beats the unweighted baseline", async () => {
  const r = await runReplay(klines);
  console.log("weights", r.weights, "learner", r.learnerPnl.toFixed(2), "baseline", r.baselinePnl.toFixed(2), "brier", r.brierBefore.toFixed(4), "->", r.brierAfter.toFixed(4));
  assert.ok(r.weights.A > r.weights.B && r.weights.B > r.weights.C, JSON.stringify(r.weights));
  assert.ok(r.learnerPnl > r.baselinePnl);
  assert.ok(r.brierAfter <= r.brierBefore);
});
test("replay is deterministic for a seed", async () => {
  const a = await runReplay(klines, { rounds: 60 });
  const b = await runReplay(klines, { rounds: 60 });
  assert.deepEqual(a.weights, b.weights);
  assert.equal(a.learnerPnl, b.learnerPnl);
});
test("robust across seeds: A ranks first and learner beats baseline", async () => {
  for (const seed of [1, 7, 99]) {
    const r = await runReplay(klines, { seed });
    assert.ok(r.weights.A > r.weights.C, `seed ${seed} ${JSON.stringify(r.weights)}`);
    assert.ok(r.learnerPnl > r.baselinePnl, `seed ${seed}`);
  }
});
