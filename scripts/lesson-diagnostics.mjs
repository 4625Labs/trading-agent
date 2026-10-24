// Free, math-only: reproduce the learner's lessons (what llm_lessons saw) at chosen cycles. No LLM, no DB.
// Usage: node --experimental-strip-types scripts/lesson-diagnostics.mjs [--seed N] [--at 10,30,60,90]
import { runEngine, loadFixtureKlines, lessonsV2 } from "../apps/worker/src/replay/index.ts";
const args = process.argv.slice(2);
const seed = args.includes("--seed") ? Number(args[args.indexOf("--seed") + 1]) : 42;
const at = (args.includes("--at") ? args[args.indexOf("--at") + 1] : "10,30,60,90").split(",").map(Number);
const snap = {}, v2 = {};
const r = await runEngine({ cycles: 100, seed, klines: loadFixtureKlines(), sources: "all", arms: ["learner"], onCycle: (rows, n) => { if (at.includes(n)) { snap[n] = rows[0].detail.lessonTexts; v2[n] = rows[0].detail.lessonsV2; } } });
for (const n of at) {
  const L = snap[n] ?? [];
  const ns = L.map((t) => { const m = /(?:lost|won) (\d+)\/(\d+)/.exec(t); return m ? +m[2] : 0; });
  const directive = L.filter((t) => /reduce size|skip|trust it more/.test(t)).length;
  console.log(`\n=== cycle ${n}: ${L.length} lessons; n per lesson min/median/max = ${Math.min(...ns)}/${[...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)]}/${Math.max(...ns)}; n<8: ${ns.filter((x) => x < 8).length}; directive: ${directive}/${L.length}`);
  L.forEach((t) => console.log("  - " + t));
}
for (const n of at) console.log(`\nv2 lessons at cycle ${n}:`, JSON.stringify(v2[n], null, 1));
