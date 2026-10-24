// 100-cycle walk-forward replay. Usage: node --experimental-strip-types --env-file=.env scripts/replay-100.mjs [--seed N] [--cycles N] [--llm [--yes]] [--no-db]
import { runReplay100, LLM_CALL_BUDGET } from "../apps/worker/src/replay/index.ts";
import { asciiChart } from "../apps/worker/src/learning/replay.ts";

const args = process.argv.slice(2);
const num = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const cycles = num("--cycles", 100), seed = num("--seed", 42), useLlm = args.includes("--llm");
let llm = null;
if (useLlm) {
  const est = Math.min(cycles * 2, LLM_CALL_BUDGET);
  console.log(`LLM mode: about ${est} Claude calls (claude-sonnet-5-5; 2 arms x ${cycles} cycles, hard cap ${LLM_CALL_BUDGET}).`);
  if (!args.includes("--yes")) { console.log("Refusing to spend without --yes."); process.exit(2); }
  const { anthropicLlm } = await import("../apps/worker/src/ingest/llm.ts");
  llm = anthropicLlm();
}
let pool = null, db = null;
if (!args.includes("--no-db")) { const { Db } = await import("../apps/worker/src/db.ts"); db = Db.fromEnv(); pool = db.pool; }
try {
  const r = await runReplay100({ pool, cycles, seed, llm, log: (s) => console.log("  " + s), onProgress: (n) => { if (n % 20 === 0) console.log(`  cycle ${n}/${cycles}`); } });
  const s = r.summary;
  console.log(`\nrun ${r.runId || "(not persisted)"}  seed=${seed} cycles=${cycles}`);
  for (const [a, x] of Object.entries(s.arms)) console.log(`${a.padEnd(14)} pnl ${x.finalPnl.toFixed(2).padStart(8)}  trades ${String(x.trades).padStart(4)}  hit ${x.hitRate?.toFixed(2)}  1st-half ${x.firstHalfPnl.toFixed(1)}/${x.firstHalfHit?.toFixed(2)}  2nd-half ${x.secondHalfPnl.toFixed(1)}/${x.secondHalfHit?.toFixed(2)}  maxDD ${x.maxDrawdown.toFixed(1)}`);
  console.log("\nsource ranking (learned weight):");
  for (const x of s.sourceRanking) console.log(`  ${x.source.padEnd(20)} ${x.kind.padEnd(9)} w=${x.learnedWeight.toFixed(2)}  observed hit ${x.observedHitRate ?? "n/a"} (${x.trials})  planted ${x.plantedHitRate ?? "-"}`);
  console.log(`\nlearner vs baseline: all sources ${s.learnerVsBaseline.all.delta.toFixed(2)} (z=${s.learnerVsBaseline.all.z.toFixed(2)}); technical only ${s.learnerVsBaseline.technicalOnly.delta.toFixed(2)} (z=${s.learnerVsBaseline.technicalOnly.z.toFixed(2)})`);
  console.log("\ncumulative PnL\n" + asciiChart(Object.fromEntries(Object.entries(r.series).filter(([k]) => k === "learner" || k === "baseline").map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]))));
  console.log(`\nVerdict: ${s.verdict}\n${s.disclaimer}`);
} finally { await db?.close(); }
