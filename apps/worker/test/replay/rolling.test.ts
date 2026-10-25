import test from "node:test";
import assert from "node:assert/strict";
import { runRollingTest, loadHistory, chooseStarts, tCrit95, signTestP, deltaStats, rollingVerdict, LOOKBACK } from "../../src/replay/rolling.ts";

const hist = loadHistory();

test("no look-ahead: rewriting all candles after a window's end leaves its results unchanged", async () => {
  const a = await runRollingTest({ pool: null, windows: 1, seed: 7, klines: hist });
  const w = a.windows[0];
  const mutated: typeof hist = {};
  for (const [k, cs] of Object.entries(hist)) mutated[k] = cs.map((c, i) => (i <= w.endIdx ? c : { ...c, o: c.o * 2, h: c.h * 3, l: c.l * 0.1, c: c.c * (i % 2 ? 0.2 : 4) }));
  const b = await runRollingTest({ pool: null, windows: 1, seed: 7, klines: mutated });
  assert.equal(b.windows[0].startIdx, w.startIdx);
  assert.deepEqual(b.windows[0].technical, w.technical);
  assert.deepEqual(b.windows[0].all, w.all);
});

test("deterministic for a seed; different seed differs", async () => {
  const a = await runRollingTest({ pool: null, windows: 4, seed: 1, klines: hist });
  const b = await runRollingTest({ pool: null, windows: 4, seed: 1, klines: hist });
  assert.deepEqual(a.summary, b.summary);
  const c = await runRollingTest({ pool: null, windows: 4, seed: 2, klines: hist });
  assert.notDeepEqual(a.windows.map((w) => w.startIdx), c.windows.map((w) => w.startIdx));
});

test("frozen weights come from the learn phase only; test starts flat; delta is learned minus baseline", async () => {
  const r = await runRollingTest({ pool: null, windows: 3, seed: 3, klines: hist });
  for (const w of r.windows) {
    for (const t of [w.technical, w.all]) {
      assert.ok(Object.keys(t.frozen).length > 0);
      assert.ok(Math.abs(t.delta - (t.arms.learned.pnl - t.arms.baseline.pnl)) < 1e-9);
      assert.ok(t.arms.learned.trades >= 0);
    }
  }
});

test("chooseStarts: in range, non-overlapping, never crossing a time gap", () => {
  const STEP = 4 * 3600 * 1000;
  const cs = Array.from({ length: 1000 }, (_, i) => ({ t: i * STEP + (i >= 500 ? STEP : 0), o: 1, h: 1, l: 1, c: 1 })); // gap before index 500
  const span = 50;
  const starts = chooseStarts(cs, 10, span, 5);
  assert.equal(starts.length, 10);
  for (const s of starts) {
    assert.ok(s >= LOOKBACK && s + span <= cs.length);
    assert.ok(!(500 > s - LOOKBACK && 500 <= s + span - 1), `window ${s} crosses the gap`);
  }
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= span);
});

test("stats: t critical values, sign test, CI and verdict honesty", () => {
  assert.equal(tCrit95(24), 2.064);
  assert.ok(tCrit95(500) === 1.96 && tCrit95(35) < 2.042 && tCrit95(35) > 2.021);
  assert.ok(Math.abs(signTestP(9, 1) - 0.0215) < 0.001); // 2*P(X<=1 | n=10)
  assert.equal(signTestP(5, 5), 1);
  const s = deltaStats([1, -1, 2, -2, 0.5, -0.5]);
  assert.ok(s.ci95[0] < 0 && s.ci95[1] > 0);
  const good = deltaStats(Array.from({ length: 20 }, (_, i) => 5 + (i % 3)));
  assert.ok(good.ci95[0] > 0);
  assert.match(rollingVerdict(s, good), /no reliable improvement/);
  assert.match(rollingVerdict(good, s), /beat equal weights/);
  assert.match(rollingVerdict(deltaStats(Array.from({ length: 20 }, (_, i) => -5 - (i % 3))), s), /WORSE/);
});

test("persists run, windows and summary with the disclaimer; failures mark the run failed", async () => {
  const q: { sql: string }[] = [];
  const pool = { query: async (sql: string) => { q.push({ sql }); return { rows: [{ id: "r1" }] }; } };
  const r = await runRollingTest({ pool, windows: 3, seed: 4, klines: hist });
  assert.equal(q.filter((x) => /insert into rolling_windows/.test(x.sql)).length, 3);
  assert.ok(q.some((x) => /status='done'/.test(x.sql)));
  assert.match(r.summary.disclaimer, /learning is frozen before each test/);
  assert.deepEqual(Object.keys(r.summary.warmStartWeights).sort(), ["breakout", "meanrev", "momentum", "volregime"]);
  const q2: string[] = [];
  const bad = { query: async (sql: string) => { q2.push(sql); return { rows: [{ id: "r2" }] }; } };
  await assert.rejects(() => runRollingTest({ pool: bad, windows: 1, klines: { BTC: hist.BTC } as any }));
  assert.ok(q2.some((s) => /status='failed'/.test(s)));
});
