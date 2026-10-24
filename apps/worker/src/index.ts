// Worker entrypoint. Usage (from apps/worker):
//   node --experimental-strip-types --env-file=../../.env src/index.ts launch "<message>"  launch a new Omnara agent, then serve it
//   node --experimental-strip-types --env-file=../../.env src/index.ts attach <agent_id>   serve one existing agent
//   node --experimental-strip-types --env-file=../../.env src/index.ts serve                serve every active agent in the DB (deployed mode)
// On Freestyle the same file runs under bun with env from the systemd EnvironmentFile.
// HIL_SIM=1 auto-taps Approve (tests only). AUTONOMY=1 turns on the news -> thesis cycle (default on for `serve`).
import { readFileSync } from "node:fs";
import { Db } from "./db.ts";
import { Omnara } from "./omnara.ts";
import { Simulator } from "./simulator.ts";
import { BinanceTestnetAdapter } from "./binance.ts";
import { Worker } from "./loop.ts";
import { Watcher } from "./watcher.ts";
import { askPendingFeedback, syncFeedback } from "./feedback.ts";
import { runLearningCycle } from "./learning/cycle.ts";
import { runIngest, defaultIngestDeps } from "./ingest/index.ts";
import { generateTheses, pgThesisReaders, proposeToAgent } from "./thesis/index.ts";
import { anthropicLlm } from "./ingest/llm.ts";
import { startHealthServer, heartbeat } from "./health.ts";

const [cmd, arg] = process.argv.slice(2);
const db = Db.fromEnv();
const omnara = await Omnara.fromEnv().init();
const real = process.env.EXCHANGE_TESTNET_API_KEY ? BinanceTestnetAdapter.fromEnv() : undefined;
const getPrice = async (asset: string) => {
  if (real) return real.price(asset);
  const r = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${asset.toUpperCase()}USDT`);
  return Number((await r.json()).price);
};
const sim = new Simulator(getPrice);
const worker = new Worker(db, omnara, { synthetic: sim, real }, { simulateHuman: process.env.HIL_SIM === "1" });
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const every = (ms: number, label: string, fn: () => Promise<unknown>) =>
  setInterval(() => fn().catch((e) => log(`${label} error: ${(e as Error).message}`)), ms);

async function register(id: string) {
  worker.agents.add(id);
  await db.pool.query("insert into agents(id,name,status) values ($1,'trading-agent','active') on conflict (id) do update set status='active'", [id]);
}
async function loadActiveAgents() {
  for (const r of (await db.pool.query("select id from agents where status='active'")).rows) worker.agents.add(r.id);
}

if (cmd === "launch") {
  const yaml = readFileSync(new URL("../agent.yaml", import.meta.url), "utf8");
  const id = await omnara.launch(yaml, arg ?? "Await instructions.", "trading-agent");
  console.log(`launched agent ${id}`);
  await register(id);
} else if (cmd === "attach" && arg) {
  await register(arg);
} else if (cmd === "serve") {
  await loadActiveAgents();
} else {
  console.log("usage: launch <message> | attach <agent_id> | serve");
  process.exit(1);
}

const autonomy = (process.env.AUTONOMY ?? (cmd === "serve" ? "1" : "0")) === "1";
console.log(`serving ${worker.agents.size} agent(s); approvals via ${process.env.HIL_SIM === "1" ? "SIMULATION" : "Omnara"}; autonomy ${autonomy ? "on" : "off"}.`);

// Health endpoint + DB heartbeat row (the dashboard reads either).
heartbeat.agents = worker.agents.size;
await startHealthServer({
  port: Number(process.env.HEALTH_PORT ?? 8080),
  getStatus: () => ({ lastTickAt: heartbeat.lastTickAt, lastIngestAt: heartbeat.lastIngestAt, agents: worker.agents.size }),
}).catch((e) => log(`health server not started: ${(e as Error).message}`));
const run = await db.pool.query("insert into runs(trigger,status) values ('worker','running') returning id");
every(10_000, "heartbeat", () => db.pool.query("update runs set finished_at=now() where id=$1", [run.rows[0].id]));

// Wallet snapshots for the dashboard.
const snapshot = async () => {
  if (real) await db.pool.query("insert into wallet_snapshots(balance) values ($1)", [await real.freeBalance("USDT")]);
};
await snapshot().catch((e) => log(`wallet snapshot error: ${(e as Error).message}`));
every(60_000, "wallet", snapshot);

// Close-out (stop/target), human feedback, learning.
const watcher = new Watcher(db, getPrice, sim, real);
void watcher.run(15_000);
const firstAgent = () => [...worker.agents][0];
every(20_000, "feedback", async () => {
  const a = firstAgent();
  if (!a) return;
  await askPendingFeedback(db, omnara, a, { max: 1, log });
  await syncFeedback(db, omnara, a, { log });
});
every(5 * 60_000, "learning", () => runLearningCycle({ pool: db.pool, log }));
if (cmd === "serve") every(60_000, "agents", loadActiveAgents);

// News -> signals -> thesis -> agent (which calls place_order; guardrails and approvals still apply).
if (autonomy) {
  const cycle = async () => {
    const a = firstAgent();
    if (!a) return log("no active agent; skipping cycle");
    await runIngest(defaultIngestDeps(db, log));
    heartbeat.ingest();
    const wallet = real ? await real.freeBalance("USDT") : 10_000;
    const theses = await generateTheses({ ...pgThesisReaders(db), llm: anthropicLlm(), price: getPrice, walletUsd: Math.min(wallet, 5_000), log });
    for (const t of theses.slice(0, 1)) {
      const dup = await db.pool.query(
        "select 1 from theses where asset=$1 and direction=$2 and status in ('proposed','pending_approval','executed') and created_at > now() - interval '6 hours' limit 1",
        [t.asset, t.direction],
      );
      if (dup.rowCount) { log(`skip ${t.asset} ${t.direction}: similar thesis already active`); continue; }
      await proposeToAgent(omnara, a, t);
      log(`proposed ${t.asset} ${t.direction} $${t.size} to the agent`);
    }
  };
  every(30 * 60_000, "cycle", cycle);
  void cycle().catch((e) => log(`cycle error: ${(e as Error).message}`));
}

await worker.run();
