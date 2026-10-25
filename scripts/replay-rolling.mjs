// Rolling "time machine" hold-out test. Usage: node --experimental-strip-types --env-file=.env scripts/replay-rolling.mjs [--windows N] [--learn N] [--test N] [--seed N] [--no-db]
import { runRollingTest } from "../apps/worker/src/replay/rolling.ts";
const args = process.argv.slice(2);
const num = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
let db = null;
if (!args.includes("--no-db")) { const { Db } = await import("../apps/worker/src/db.ts"); db = Db.fromEnv(); }
const t0 = Date.now();
try {
  const r = await runRollingTest({ pool: db?.pool ?? null, windows: num("--windows", 25), learnCycles: num("--learn", 30), testCycles: num("--test", 20), seed: num("--seed", 42) });
  console.log(`run ${r.runId || "(not persisted)"}  ${r.windows.length} windows  history ${r.params.historyStart.slice(0, 10)} -> ${r.params.historyEnd.slice(0, 10)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log("\n  k  start       | technical: learned  baseline  delta | all: learned  baseline  delta");
  for (const w of r.windows) console.log(`${String(w.k).padStart(3)}  ${w.startTs.slice(0, 10)}  | ${w.technical.arms.learned.pnl.toFixed(1).padStart(15)} ${w.technical.arms.baseline.pnl.toFixed(1).padStart(9)} ${w.technical.delta.toFixed(1).padStart(8)} | ${w.all.arms.learned.pnl.toFixed(1).padStart(13)} ${w.all.arms.baseline.pnl.toFixed(1).padStart(9)} ${w.all.delta.toFixed(1).padStart(8)}`);
  for (const [name, s] of [["technical only", r.summary.technicalOnly], ["all sources", r.summary.allSources]]) {
    console.log(`\n[${name}] mean delta ${s.meanDelta.toFixed(2)}  sd ${s.sd.toFixed(2)}  se ${s.se.toFixed(2)}  95% CI [${s.ci95[0].toFixed(2)}, ${s.ci95[1].toFixed(2)}] (${s.ciMethod})  t=${s.t.toFixed(2)}`);
    console.log(`  frozen learner beat baseline in ${s.windowsWon}/${s.n} (${(s.shareWon * 100).toFixed(0)}%), sign-test p=${s.signTestP.toFixed(3)}; continuing learner mean delta ${s.continuingLearner.meanDelta.toFixed(2)} (CI ${s.continuingLearner.ci95.map((x) => x.toFixed(2)).join(" to ")})`);
    console.log(`  hit learned ${s.meanLearnedHit.toFixed(3)} vs baseline ${s.meanBaselineHit.toFixed(3)}; maxDD ${s.meanLearnedMaxDD.toFixed(1)} vs ${s.meanBaselineMaxDD.toFixed(1)}; trades ${s.meanLearnedTrades.toFixed(1)} vs ${s.meanBaselineTrades.toFixed(1)}; mean PnL ${s.meanLearnedPnl.toFixed(2)} vs ${s.meanBaselinePnl.toFixed(2)}`);
  }
  console.log("\nwarmStartWeights (technical):", JSON.stringify(r.summary.warmStartWeights), " planted mean frozen weights:", JSON.stringify(r.summary.plantedMeanFrozenWeights));
  console.log(`\nVerdict: ${r.summary.verdict}\n${r.summary.disclaimer}`);
} finally { await db?.close(); }
