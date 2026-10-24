// One DRY ingest + thesis cycle (nothing is sent to the agent). Run from repo root:
//   node --experimental-strip-types --env-file=.env scripts/ingest-run.mjs
import { Db } from "../apps/worker/src/db.ts";
import { runIngest, defaultIngestDeps } from "../apps/worker/src/ingest/index.ts";
import { anthropicLlm } from "../apps/worker/src/ingest/llm.ts";
import { generateTheses, pgThesisReaders, proposalText } from "../apps/worker/src/thesis/index.ts";
import { BinanceTestnetAdapter } from "../apps/worker/src/binance.ts";

const log = (m) => console.log("  ·", String(m).slice(0, 200));
const db = Db.fromEnv();
try {
  const ing = await runIngest(defaultIngestDeps(db, log));
  console.log("ingest:", JSON.stringify(ing));
  const adapter = process.env.EXCHANGE_TESTNET_API_KEY ? BinanceTestnetAdapter.fromEnv() : null;
  const price = adapter
    ? (a) => adapter.price(a)
    : async (a) => Number((await (await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${a}USDT`)).json()).price);
  const theses = await generateTheses({ ...pgThesisReaders(db), llm: anthropicLlm(), price, walletUsd: Number(process.env.WALLET_USD ?? 10000), log });
  console.log(`theses: ${theses.length}`);
  if (theses[0]) { console.log("sample rationale:", theses[0].rationale); console.log("sample proposal:\n" + proposalText(theses[0])); }
} catch (e) {
  console.log("FAIL", String(e.message).slice(0, 300));
  process.exitCode = 1;
} finally { await db.close(); }
