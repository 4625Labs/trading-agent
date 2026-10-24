// Planted-truth replay. Run: node --experimental-strip-types scripts/replay-planted-truth.mjs [--refresh] [--seed N] [--rounds N]
// Klines are cached in apps/worker/test/fixtures; --refresh re-downloads from the public api.binance.us endpoint.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { asciiChart, fetchKlines, parseKlines, runReplay } from "../apps/worker/src/learning/replay.ts";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const dir = new URL("../apps/worker/test/fixtures/", import.meta.url);
mkdirSync(dir, { recursive: true });
const klines = {};
for (const a of ["BTC", "ETH", "SOL"]) {
  const f = new URL(`klines-${a}.json`, dir);
  if (args.includes("--refresh") || !existsSync(f)) { writeFileSync(f, JSON.stringify(await fetchKlines(a))); console.log(`fetched ${a}`); }
  klines[a] = parseKlines(JSON.parse(readFileSync(f, "utf8")));
}
const r = await runReplay(klines, { seed: opt("--seed", 42), rounds: opt("--rounds", 300) });
console.log(`rounds=${r.rounds}  planted hit rates: A=0.65 B=0.50 C=0.35`);
console.log("\nweight trajectory (round: A  B  C)");
const step = Math.max(1, Math.floor(r.rounds / 10));
r.trajectory.forEach((w, i) => { if (i % step === 0 || i === r.rounds - 1) console.log(`  ${String(i + 1).padStart(4)}: ${["A", "B", "C"].map((s) => w[s].toFixed(2).padStart(5)).join(" ")}`); });
console.log("\nobserved per-source hit rate:", Object.entries(r.stats).map(([s, x]) => `${s}=${x.hitRate.toFixed(2)}(${x.trials})`).join(" "));
console.log(`\ncumulative PnL (USD): learner ${r.learnerPnl.toFixed(2)} (win ${(r.learnerWinRate * 100).toFixed(0)}%)  vs unweighted baseline ${r.baselinePnl.toFixed(2)} (win ${(r.baselineWinRate * 100).toFixed(0)}%)`);
console.log(`calibration Brier (held-out half): before ${r.brierBefore.toFixed(4)}  after ${r.brierAfter.toFixed(4)}`);
console.log("\nlearning curve: cumulative PnL\n" + asciiChart({ Learner: r.learnerCum, Baseline: r.baselineCum }));
const pass = r.weights.A > r.weights.B && r.weights.B > r.weights.C && r.learnerPnl > r.baselinePnl;
console.log(`\n${pass ? "PASS" : "FAIL"}: final weights A>B>C and learner PnL > baseline`);
process.exitCode = pass ? 0 : 1;
