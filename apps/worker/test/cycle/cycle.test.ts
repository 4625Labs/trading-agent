import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, loadConfig, saveConfig, runCycle, DEFAULT_CONFIG } from "../../src/cycle.ts";
import { nextCalibration, computeExecutionGap, recalibrateSim } from "../../src/execgap.ts";
import { Simulator } from "../../src/simulator.ts";

test("normalizeConfig clamps and defaults", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const c = normalizeConfig({ enabled: "false", intervalSeconds: 5, assets: ["btc", "DOGE"], confidenceBar: 2, maxTradesPerCycle: 9.4, tradeSizeUsd: "1", realOrders: 3 });
  assert.deepEqual(c, { enabled: false, intervalSeconds: 60, assets: ["BTC"], confidenceBar: 0.95, maxTradesPerCycle: 5, tradeSizeUsd: 5, realOrders: true });
  assert.deepEqual(normalizeConfig({ assets: ["XRP"] }).assets, ["BTC", "ETH", "SOL"]);
});

function fakePool(store: { config?: any }) {
  const calls: { sql: string; params?: any[] }[] = [];
  return {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/from agent_config/.test(sql)) return { rows: store.config ? [{ data: store.config }] : [], rowCount: store.config ? 1 : 0 };
      if (/insert into agent_config/.test(sql)) { store.config = JSON.parse(params![params!.length - 1] ?? params![0]); return { rows: [], rowCount: 1 }; }
      if (/insert into cycles/.test(sql)) return { rows: [{ id: "cyc1" }], rowCount: 1 };
      if (/from theses where asset/.test(sql)) return { rows: [], rowCount: 0 };
      if (/from sources/.test(sql)) return { rows: [{ id: "s", url: "coindesk.com", weight: 1.3 }] };
      if (/from lessons/.test(sql)) return { rows: [{ c: 2 }] };
      return { rows: [], rowCount: 0 };
    },
  };
}

test("loadConfig creates defaults; saveConfig validates", async () => {
  const store: any = {};
  const db = { pool: fakePool(store) };
  assert.deepEqual(await loadConfig(db), DEFAULT_CONFIG);
  assert.ok(store.config);
  const s = await saveConfig(db, { tradeSizeUsd: 9999, confidenceBar: 0.7 });
  assert.equal(s.tradeSizeUsd, 500); assert.equal(s.confidenceBar, 0.7);
});

const prefs = { allowedAssets: ["BTC", "ETH", "SOL"], bannedAssets: [], maxPositionPct: 0.05, approvalThresholdUsd: 25, minConfidence: 0.1 };
const sig = (id: string, asset: string) => ({ id, asset, direction: "long", magnitude: 0.6, horizon: "1d", confidence: 0.8, url: "u", source_name: "coindesk.com", rationale: "r", weight: 1.3 });
const th = (asset: string, conf: number) => ({ asset, direction: "long", size: 999, entry: 1, stop: 90, target: 120, confidence: conf, rationale: "why", signalIds: [asset === "BTC" ? "a" : "b"] });

test("runCycle: assets filter, confidence bar, size forced, max trades, ledger row", async () => {
  const pool = fakePool({});
  const sent: string[] = [];
  const events: string[] = [];
  const res = await runCycle({
    db: { pool }, omnara: { send: async (_a: string, t: string) => { sent.push(t); } }, agents: () => ["ag"],
    llm: async () => JSON.stringify({ theses: [th("BTC", 0.9), th("ETH", 0.7), th("SOL", 0.9), { ...th("ETH", 0.3) }] }),
    price: async () => 100, walletUsd: 2000,
    readers: { prefs: async () => prefs, readSignals: async () => [sig("a", "BTC"), sig("b", "ETH"), sig("c", "SOL")], lessons: async () => ["L"] },
    ingest: async () => ({ searches: 3, articles: 4, extracted: 3, inserted: 3, duplicates: 0, errors: 0 }),
    emit: async (k) => { events.push(k); },
  }, { ...DEFAULT_CONFIG, assets: ["BTC", "ETH"], confidenceBar: 0.6, maxTradesPerCycle: 1, tradeSizeUsd: 30 });
  assert.equal(res.signalsConsidered, 2); // SOL filtered
  assert.equal(res.proposed.length, 1); assert.equal(res.proposed[0].asset, "BTC");
  assert.equal(res.proposed[0].size, 30);
  assert.match(sent[0], /"size":30/); assert.deepEqual(events, ["ingest", "thesis_proposed"]);
  const upd = pool.calls.find((c) => /update cycles set finished_at/.test(c.sql))!;
  assert.equal(upd.params![4], 3); assert.equal(upd.params![8], 2); assert.equal(JSON.parse(upd.params![7]).hasOwnProperty("coindesk.com"), true);
  assert.equal(JSON.parse(upd.params![2]).proposals[0].asset, "BTC");
});

test("simulator.configure changes costs and clamps", () => {
  const s = new Simulator(async () => 100);
  s.configure({ slippageBps: 12, feeBps: -4 });
  assert.deepEqual(s.config, { slippageBps: 12, feeBps: 0 });
});

test("nextCalibration: EMA, clamp, n<3 no change", () => {
  const cur = { slippageBps: 5, feeBps: 10 };
  assert.equal(nextCalibration(cur, { n: 2, avgSlippageGapBps: 10, avgFeeGapBps: 10 }).calibrated, false);
  const n = nextCalibration(cur, { n: 5, avgSlippageGapBps: 10, avgFeeGapBps: -4 });
  assert.ok(Math.abs(n.slippageBps - (5 * 0.7 + 15 * 0.3)) < 1e-9); assert.ok(Math.abs(n.feeBps - (10 * 0.7 + 6 * 0.3)) < 1e-9);
  const hi = nextCalibration({ slippageBps: 50, feeBps: 0 }, { n: 5, avgSlippageGapBps: 500, avgFeeGapBps: -500 });
  assert.equal(hi.slippageBps, 50); assert.equal(hi.feeBps, 0);
});

test("execution gap against DB fixtures (rolled-back transaction)", { skip: !process.env.DATABASE_URL }, async () => {
  const { Db } = await import("../../src/db.ts");
  const db = Db.fromEnv();
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    const mk = async (dir: string, demo: boolean, real: boolean, sFill: number, rFill: number) => {
      const t = (await c.query("insert into theses(asset,direction,entry,size,stop,target,status,demo,closed_at,pnl) values ('BTC',$1,100,100,90,110,'closed',$2,now(),1) returning id", [dir, demo])).rows[0].id;
      await c.query("insert into synthetic_trades(thesis_id,fill_price,qty,fee,exit_price,pnl,closed_at) values ($1,$2,1,0.1,105,5,now())", [t, sFill]);
      if (real) await c.query("insert into real_trades(thesis_id,venue,fill_price,qty,fee,exit_price,pnl) values ($1,'testnet',$2,1,0.2,104,4)", [t, rFill]);
      return t as string;
    };
    const ids = [await mk("long", false, true, 100, 100.1), await mk("long", false, true, 100, 100.2), await mk("long", false, true, 100, 100.3),
      await mk("long", true, true, 100, 105), await mk("short", false, false, 100, 100)];
    const { trades, summary } = await computeExecutionGap(c, { thesisIds: ids });
    assert.equal(summary.n, 3); assert.equal(summary.excludedDemo, 1); assert.equal(summary.excludedShortsNoRealLeg, 1);
    assert.ok(Math.abs(summary.avgSlippageGapBps - 20) < 1e-6); assert.equal(trades[0].pnlGap, 1);
    const r = await recalibrateSim(c, { slippageBps: 5, feeBps: 10 }, { thesisIds: ids });
    assert.equal(r.calibrated, true); assert.ok(r.slippageBps > 5);
  } finally { await c.query("rollback"); c.release(); await db.close(); }
});

test("updateCycleOutcomes links by window+asset/direction and fills outcomes (rolled back)", { skip: !process.env.DATABASE_URL }, async () => {
  const { Db } = await import("../../src/db.ts");
  const { updateCycleOutcomes } = await import("../../src/cycle.ts");
  const db = Db.fromEnv();
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    const cyc = (await c.query("insert into cycles(started_at,config) values (now() - interval '10 minutes',$1) returning id", [JSON.stringify({ proposals: [{ asset: "ETH", direction: "long", size: 5 }] })])).rows[0].id;
    const mk = async (asset: string, pnl: number | null, status: string, demo = false) =>
      (await c.query("insert into theses(asset,direction,entry,size,stop,target,status,pnl,demo) values ($1,'long',1,1,1,1,$2,$3,$4) returning id", [asset, status, pnl, demo])).rows[0].id;
    const a = await mk("ETH", 3, "closed"); await mk("BTC", 9, "closed"); await mk("ETH", 100, "closed", true);
    const r1 = await updateCycleOutcomes({ pool: c });
    const row = (await c.query("select thesis_ids, closed, wins, pnl from cycles where id=$1", [cyc])).rows[0];
    assert.ok(row.thesis_ids.includes(a)); assert.equal(row.thesis_ids.length, 2); assert.equal(row.closed, 1); assert.equal(+row.pnl, 3);
    assert.ok(r1.cyclesUpdated >= 1);
    const r2 = await updateCycleOutcomes({ pool: c });
    assert.equal(r2.linked, 0);
  } finally { await c.query("rollback"); c.release(); await db.close(); }
});
