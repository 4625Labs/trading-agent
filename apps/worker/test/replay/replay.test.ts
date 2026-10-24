import test from "node:test";
import assert from "node:assert/strict";
import { loadFixtureKlines, runReplay100, runEngine, technicalSignals, validateDecisions, llmDecider, WARMUP } from "../../src/replay/index.ts";

const klines = loadFixtureKlines();

function fakePool() {
  const q: { sql: string; p: unknown[] }[] = [];
  return { q, query: async (sql: string, p: unknown[] = []) => { q.push({ sql, p }); return { rows: [{ id: "run-1" }] }; } };
}

test("deterministic for a seed without llm", async () => {
  const a = await runReplay100({ pool: null, cycles: 40, seed: 5 });
  const b = await runReplay100({ pool: null, cycles: 40, seed: 5 });
  assert.deepEqual(a.summary, b.summary);
  assert.deepEqual(a.series, b.series);
  const c = await runReplay100({ pool: null, cycles: 40, seed: 6 });
  assert.notDeepEqual(a.series.learner, c.series.learner);
});

test("no look-ahead: altering candles after step T leaves earlier technical-only cycles unchanged", async () => {
  const T = WARMUP + 40; // decision candle index of cycle 41 (k=40)
  const mutated: typeof klines = {};
  for (const [a, cs] of Object.entries(klines)) mutated[a] = cs.map((c, i) => (i <= T ? c : { ...c, o: c.o * 1.3, h: c.h * 1.5, l: c.l * 0.6, c: c.c * (i % 2 ? 0.7 : 1.4) }));
  const rows = (kl: typeof klines) => {
    const out: unknown[] = [];
    return runEngine({ cycles: 60, seed: 1, klines: kl, sources: "technical", arms: ["learner", "baseline"], onCycle: (r, n) => { if (n <= 41) out.push(r); } }).then(() => out);
  };
  assert.deepEqual(await rows(klines), await rows(mutated));
  // signals at index T depend only on candles <= T
  for (const a of ["BTC", "ETH", "SOL"]) assert.deepEqual(technicalSignals(klines[a], T, a), technicalSignals(mutated[a], T, a));
});

test("persists run, cycle rows and summary with disclaimer", async () => {
  const pool = fakePool();
  const r = await runReplay100({ pool, cycles: 10, seed: 3 });
  assert.equal(pool.q.filter((x) => /insert into replay_cycles/.test(x.sql)).length, 20); // 10 cycles x 2 arms
  assert.ok(pool.q.some((x) => /status='done'/.test(x.sql)));
  assert.match(r.summary.disclaimer, /not live trading/);
  assert.ok(r.summary.verdict.length > 50);
});

test("validateDecisions clamps and filters", () => {
  const d = validateDecisions({ trades: [{ asset: "btc", direction: "LONG", size: 9999, confidence: 3 }, { asset: "DOGE", direction: "long", size: 50, confidence: 0.5 }, { asset: "BTC", direction: "short", size: 50, confidence: 0.5 }, { asset: "eth", direction: "x", size: 1, confidence: 1 }] });
  assert.deepEqual(d, [{ asset: "BTC", direction: "long", size: 200, confidence: 1 }]);
  assert.deepEqual(validateDecisions("junk"), []);
});

test("llm arms: both run with a fake llm, lessons only in lessons arm, failures skip, budget respected", async () => {
  const prompts: Record<string, string[]> = { with: [], without: [] };
  let n = 0;
  const llm = async (req: { prompt: string }) => {
    n++;
    (req.prompt.includes("Lessons learned") ? prompts.with : prompts.without).push(req.prompt);
    if (n === 3) throw new Error("boom");
    return '```json\n{"trades":[{"asset":"BTC","direction":"long","size":50,"confidence":0.7}]}\n```';
  };
  const r = await runReplay100({ pool: null, cycles: 12, seed: 2, llm: llm as any });
  assert.equal(prompts.with.length, 11);
  assert.equal(prompts.without.length, 11);
  assert.ok(r.summary.llm!.skippedCycles >= 1);
  assert.ok(r.summary.arms.llm_lessons && r.summary.arms.llm_nolessons);
  assert.equal(r.summary.llm!.calls, 22);
});

test("llmDecider times out", async () => {
  const d = llmDecider(() => new Promise(() => {}), 20);
  const ctx = { signals: [], prices: { BTC: 1, ETH: 1, SOL: 1 }, hitRates: {}, lessons: [] };
  assert.equal((await d("llm_nolessons", ctx)) ?? null, null);
});

import { lessonsV2 } from "../../src/replay/index.ts";
const T = (asset: string, dir: "long" | "short", pnl: number, srcDir: "long" | "short" = dir) => ({ thesisId: "x", asset, direction: dir, confidence: 0.6, pnl, signals: [{ sourceId: "momentum", direction: srcDir, confidence: 0.6 }] });
test("lessonsV2: n>=8 gate, descriptive, top 3, disagreeing sources get no credit", () => {
  assert.deepEqual(lessonsV2(Array.from({ length: 7 }, () => T("BTC", "long", -1))), []);
  const trades = [...Array.from({ length: 10 }, () => T("BTC", "short", 1)), ...Array.from({ length: 9 }, (_, i) => T("ETH", "long", i < 4 ? 1 : -1)), ...Array.from({ length: 8 }, () => T("SOL", "long", 1, "short"))];
  const L = lessonsV2(trades);
  assert.ok(L.length <= 3 && L.length >= 1);
  assert.match(L[0], /^Observed 10 wins in 10 resolved BTC short trades/);
  assert.ok(!L.some((l) => /reduce|avoid|skip|should|must/i.test(l)));
  assert.ok(!L.some((l) => /8 resolved trades where the momentum/.test(l))); // SOL trades: source disagreed => not credited
});
test("v1 prompt unchanged, v2 prompt carries the weak-evidence note", async () => {
  const seen: string[] = [];
  const llm = async (r: { prompt: string }) => { seen.push(r.prompt); return '{"trades":[]}'; };
  const ctx = { signals: [], prices: { BTC: 1, ETH: 1, SOL: 1 }, hitRates: {}, lessons: ["x"] };
  const d = llmDecider(llm as any);
  await d("llm_lessons", { ...ctx, lessonStyle: "v1" });
  await d("llm_lessons", { ...ctx, lessonStyle: "v2" });
  assert.match(seen[0], /Lessons learned so far:\n- x$/);
  assert.match(seen[1], /Observations so far:\n- x\n\nNote on lessons: they are weak/);
});
