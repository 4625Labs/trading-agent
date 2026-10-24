// Worker entrypoint. Usage:
//   node --experimental-strip-types --env-file=../../.env src/index.ts launch "<message>"   (launch a new Omnara agent, then serve it)
//   node --experimental-strip-types --env-file=../../.env src/index.ts attach <agent_id>   (serve an existing agent)
// Set HIL_SIM=1 to auto-tap Approve (tests only). Without it, a human answers in the Omnara app.
import { readFileSync } from "node:fs";
import { Db } from "./db.ts";
import { Omnara } from "./omnara.ts";
import { Simulator } from "./simulator.ts";
import { BinanceTestnetAdapter } from "./binance.ts";
import { Worker } from "./loop.ts";

const [cmd, arg] = process.argv.slice(2);
const db = Db.fromEnv();
const omnara = await Omnara.fromEnv().init();
const real = process.env.EXCHANGE_TESTNET_API_KEY ? BinanceTestnetAdapter.fromEnv() : undefined;
const sim = new Simulator((asset) => (real ? real.price(asset) : Promise.reject(new Error("no price source"))));
const worker = new Worker(db, omnara, { synthetic: sim, real }, { simulateHuman: process.env.HIL_SIM === "1" });

if (cmd === "launch") {
  const yaml = readFileSync(new URL("../agent.yaml", import.meta.url), "utf8");
  const id = await omnara.launch(yaml, arg ?? "Await instructions.", "trading-agent");
  console.log(`launched agent ${id}`);
  worker.agents.add(id);
} else if (cmd === "attach" && arg) {
  worker.agents.add(arg);
} else {
  console.log("usage: launch <message> | attach <agent_id>");
  process.exit(1);
}
console.log(`serving ${worker.agents.size} agent(s); human approvals via ${process.env.HIL_SIM === "1" ? "SIMULATION" : "Omnara app"}. Ctrl+C to stop.`);
await worker.run();
