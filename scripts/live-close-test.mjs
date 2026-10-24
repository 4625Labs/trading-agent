// Live-forced close test against the real DB with a fake price feed (no venue, no Omnara).
// Run: node --experimental-strip-types --env-file=.env scripts/live-close-test.mjs
import { Db } from "../apps/worker/src/db.ts";
import { Simulator } from "../apps/worker/src/simulator.ts";
import { Watcher } from "../apps/worker/src/watcher.ts";

const db = Db.fromEnv();
const ids = [];
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) failed++; };
const redact = (e) => String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<db-url>");

async function seed(direction, withReal) {
  const t = { asset: "BTC", direction, entry: 100, size: 100, stop: direction === "long" ? 95 : 105, target: direction === "long" ? 110 : 90, rationale: "live-close-test", confidence: 0.7, signalIds: [] };
  const id = await db.insertThesis(t, "executed");
  scope.add(id);
  ids.push(id);
  await db.pool.query("insert into synthetic_trades(thesis_id,fill_price,qty,fee) values ($1,100.05,0.9995,0.1)", [id]);
  if (withReal) await db.pool.query("insert into real_trades(thesis_id,venue,fill_price,qty,fee) values ($1,'testnet',100.05,0.9995,0.1)", [id]);
  return id;
}

const scope = new Set();
try {
  const price = { BTC: 100 };
  const sold = [];
  const real = { closePosition: async (thesisId, asset, qty) => { sold.push({ thesisId, qty }); return { thesisId, venue: "testnet", fillPrice: price[asset], qty, fee: 0.1, ts: new Date().toISOString() }; } };
  const sim = new Simulator(async (a) => price[a]);
  const w = new Watcher(db, async (a) => price[a], sim, real, { log: () => {}, scope });

  const winId = await seed("long", true);
  const lossId = await seed("long", false);
  await w.tick();
  check("no close while price inside the band", (await db.getThesis(winId)).status === "executed");

  price.BTC = 111; // target for both
  const closed1 = await w.tick();
  check("tick reports both closes", closed1.length === 2, `(${closed1.length})`);
  const th = (await db.pool.query("select status,exit_reason,pnl,closed_at from theses where id=$1", [winId])).rows[0];
  check("thesis closed at target with positive pnl", th.status === "closed" && th.exit_reason === "target" && +th.pnl > 0 && th.closed_at, `pnl=${(+th.pnl).toFixed(2)}`);
  const st = (await db.pool.query("select pnl,closed_at,exit_reason from synthetic_trades where thesis_id=$1", [winId])).rows[0];
  check("synthetic_trades pnl/closed_at written", +st.pnl > 0 && !!st.closed_at && st.exit_reason === "target");
  const rt = (await db.pool.query("select pnl,closed_at,exit_price from real_trades where thesis_id=$1", [winId])).rows[0];
  check("real_trades pnl/closed_at written, one sell", rt.pnl !== null && !!rt.closed_at && sold.length === 1);

  // idempotency + crash recovery: fresh Watcher/Simulator must not re-close or re-sell
  const w2 = new Watcher(db, async (a) => price[a], new Simulator(async (a) => price[a]), real, { log: () => {}, scope });
  const again = await w2.tick();
  check("idempotent: second watcher does nothing", again.length === 0 && sold.length === 1);

  // restart rehydration: a stop hit on a position the new simulator has never seen
  const stopId = await seed("long", false);
  price.BTC = 90;
  const w3 = new Watcher(db, async (a) => price[a], new Simulator(async (a) => price[a]), real, { log: () => {}, scope });
  const c3 = await w3.tick();
  const s3 = (await db.pool.query("select status,exit_reason,pnl from theses where id=$1", [stopId])).rows[0];
  check("rehydrated position closes at stop with loss", s3.status === "closed" && s3.exit_reason === "stop" && +s3.pnl < 0 && c3.some((c) => c.thesisId === stopId), `pnl=${(+s3.pnl).toFixed(2)}`);
} catch (e) {
  console.log("ERROR", redact(e));
  failed++;
} finally {
  if (ids.length) {
    await db.pool.query("delete from synthetic_trades where thesis_id = any($1::uuid[])", [ids]).catch(() => {});
    await db.pool.query("delete from real_trades where thesis_id = any($1::uuid[])", [ids]).catch(() => {});
    await db.pool.query("delete from theses where id = any($1::uuid[])", [ids]).catch(() => {});
  }
  await db.close();
  console.log(failed ? `FAILED (${failed})` : "PASS (cleaned up)");
  process.exitCode = failed ? 1 : 0;
}
