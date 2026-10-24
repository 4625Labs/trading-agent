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
import { emit } from "./trace.ts";
import { setUsageSink } from "./usage.ts";
import { pollCommands, overriddenPrice, priceOverrides } from "./commands.ts";

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
// Persist every integration call for the dashboard's usage tiles (fire-and-forget).
setUsageSink((r) => {
  void db.pool
    .query("insert into api_usage(provider,endpoint,status,credits_used,credits_remaining,detail) values ($1,$2,$3,$4,$5,$6)", [r.provider, r.endpoint, r.status ?? null, r.creditsUsed ?? null, r.creditsRemaining ?? null, JSON.stringify(r.detail ?? {})])
    .catch(() => {});
});
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
} else if (cmd === "create") {
  // Launch + register an agent, then exit; the deployed worker picks it up in `serve` mode.
  const yaml = readFileSync(new URL("../agent.yaml", import.meta.url), "utf8");
  const id = await omnara.launch(yaml, arg ?? "Await instructions.", "trading-agent");
  await register(id);
  console.log(`created and registered agent ${id}`);
  await db.close();
  process.exit(0);
} else if (cmd === "attach" && arg) {
  await register(arg);
} else if (cmd === "serve") {
  await loadActiveAgents();
} else {
  console.log("usage: launch <message> | create | attach <agent_id> | serve");
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
const watchPrice = async (asset: string) => overriddenPrice(asset) ?? getPrice(asset);
const watcher = new Watcher(db, watchPrice, sim, real);
every(15_000, "watcher", async () => {
  for (const c of await watcher.tick()) {
    const demo = priceOverrides.has(c.asset);
    await emit(db, "position_closed", `${c.asset} position closed at ${c.reason}${demo ? " (demo price move)" : ""}: ${c.pnl >= 0 ? "+" : ""}$${c.pnl.toFixed(2)}`, { reason: c.reason, pnl: c.pnl, demo }, c.thesisId);
    priceOverrides.delete(c.asset);
  }
});
const firstAgent = () => [...worker.agents][0];
every(20_000, "feedback", async () => {
  const a = firstAgent();
  if (!a) return;
  // Feedback is collected in the dashboard (the agent is single-threaded and can be blocked on an approval).
  if (process.env.FEEDBACK_VIA_AGENT === "1") await askPendingFeedback(db, omnara, a, { max: 1, log });
  const n = await syncFeedback(db, omnara, a, { log });
  if (n) {
    const fresh = await db.pool.query("select id,feedback from theses where feedback is not null and id not in (select thesis_id from agent_events where kind='feedback' and thesis_id is not null)");
    for (const r of fresh.rows) await emit(db, "feedback", `You said: ${r.feedback}`, { answer: r.feedback }, r.id);
    const l = await runLearningCycle({ pool: db.pool, log });
    if (l.trades > 0) await emit(db, "learning", `Learning update from ${l.trades} closed trades: ${l.lessonsWritten} lessons`, { closedTrades: l.trades, lessons: l.lessonsWritten, brier: l.brier, weights: l.weights });
  }
});
every(5 * 60_000, "learning", async () => {
  const r = await runLearningCycle({ pool: db.pool, log });
  if (r.trades > 0) await emit(db, "learning", `Learning update from ${r.trades} closed trades: ${r.lessonsWritten} lessons`, { closedTrades: r.trades, lessons: r.lessonsWritten, brier: r.brier, weights: r.weights });
});
if (cmd === "serve") every(60_000, "agents", loadActiveAgents);

// Demo/ops commands queued from the dashboard.
const cmdDeps = { db, omnara, agent: firstAgent, llm: anthropicLlm(), price: getPrice, walletUsd: async () => (real ? real.freeBalance("USDT") : 10_000), log };
every(4_000, "commands", () => pollCommands(cmdDeps));

// News -> signals -> thesis -> agent (which calls place_order; guardrails and approvals still apply).
if (autonomy) {
  const cycle = async () => {
    const a = firstAgent();
    if (!a) return log("no active agent; skipping cycle");
    const cycleStart = new Date();
    const res = await runIngest(defaultIngestDeps(db, log));
    heartbeat.ingest();
    const fresh = (await db.pool.query("select id,asset,direction,confidence,magnitude,horizon,url,source_name,rationale from signals where created_at >= $1 order by created_at", [cycleStart])).rows;
    await emit(db, "ingest", `Read ${res.articles} news articles from ${res.searches} searches, found ${res.inserted} new signals (${res.duplicates} already known)`, { ...res, sources: [...new Map(fresh.map((x) => [x.url, { title: x.source_name ?? x.url, url: x.url }])).values()] }, null, a);
    for (const x of fresh) {
      await emit(db, "signal", `${x.asset} looks ${x.direction === "long" ? "bullish" : "bearish"} (confidence ${Math.round(x.confidence * 100)}%)${x.source_name ? ` per ${x.source_name}` : ""}`, { id: x.id, asset: x.asset, direction: x.direction, confidence: x.confidence, magnitude: x.magnitude, horizon: x.horizon, url: x.url, source_name: x.source_name, rationale: x.rationale }, null, a);
    }
    const wallet = real ? await real.freeBalance("USDT") : 10_000;
    const theses = await generateTheses({ ...pgThesisReaders(db), llm: anthropicLlm(), price: getPrice, walletUsd: Math.min(wallet, 5_000), log });
    for (const t of theses.slice(0, 1)) {
      const dup = await db.pool.query(
        "select 1 from theses where asset=$1 and direction=$2 and status in ('proposed','pending_approval','executed') and created_at > now() - interval '6 hours' limit 1",
        [t.asset, t.direction],
      );
      if (dup.rowCount) { log(`skip ${t.asset} ${t.direction}: similar thesis already active`); continue; }
      await emit(db, "thesis_proposed", `Idea: ${t.direction} ${t.asset} $${t.size}. Why: ${t.rationale}`, { asset: t.asset, direction: t.direction, size: t.size, entry: t.entry, stop: t.stop, target: t.target, confidence: t.confidence, rationale: t.rationale, venueHint: t.venueHint, signalIds: t.signalIds }, null, a);
      await proposeToAgent(omnara, a, t);
      log(`proposed ${t.asset} ${t.direction} $${t.size} to the agent`);
    }
  };
  every(30 * 60_000, "cycle", cycle);
  void cycle().catch((e) => log(`cycle error: ${(e as Error).message}`));
}

await worker.run();
