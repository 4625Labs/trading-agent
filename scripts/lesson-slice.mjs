// Diagnostic LLM slice (spends Claude calls: about 2*(cycles-1)). Usage: node --experimental-strip-types --env-file=.env scripts/lesson-slice.mjs --yes [--style v1|v2] [--cycles 20] [--seed 42] [--keep]
import { runReplay100 } from "../apps/worker/src/replay/index.ts";
import { anthropicLlm } from "../apps/worker/src/ingest/llm.ts";
import { Db } from "../apps/worker/src/db.ts";
const a = process.argv.slice(2);
const get = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const cycles = +get("--cycles", 20), style = get("--style", "v1"), seed = +get("--seed", 42), from = +get("--from", 1);
console.log(`style=${style} cycles=${cycles}: about ${2 * (cycles - 1)} Claude calls`);
if (!a.includes("--yes")) { console.log("need --yes"); process.exit(2); }
const db = Db.fromEnv();
try {
  const r = await runReplay100({ pool: db.pool, cycles, seed, llm: anthropicLlm(), lessonStyle: style, llmFrom: from, log: (s) => console.log("  " + s) });
  const rows = (await db.pool.query("select n,arm,trades,pnl,cum_pnl,detail from replay_cycles where run_id=$1 and arm in ('llm_lessons','llm_nolessons') order by n,arm", [r.runId])).rows;
  const sum = {};
  for (const arm of ["llm_lessons", "llm_nolessons"]) {
    const rs = rows.filter((x) => x.arm === arm);
    const opened = rs.flatMap((x) => (x.detail.trades ?? []).map((t) => ({ n: x.n, ...t })));
    const closed = rs.flatMap((x) => x.detail.closed ?? []);
    const wins = closed.filter((c) => c.pnl > 0).length;
    sum[arm] = { opened: opened.length, closed: closed.length, wins, pnl: +closed.reduce((s, c) => s + c.pnl, 0).toFixed(2), avgSize: +(opened.reduce((s, t) => s + t.size, 0) / Math.max(1, opened.length)).toFixed(1), longs: opened.filter((t) => t.direction === "long").length, shorts: opened.filter((t) => t.direction === "short").length, avgConf: +(opened.reduce((s, t) => s + t.confidence, 0) / Math.max(1, opened.length)).toFixed(2), skipped: rs.filter((x) => x.detail.skipped).length, opened_list: opened, closed_list: closed };
  }
  console.log("\narm summary:");
  for (const [k, v] of Object.entries(sum)) { const { opened_list, closed_list, ...rest } = v; console.log(" ", k, JSON.stringify(rest)); }
  console.log("\ncycle-by-cycle (opened trades: ASSET dir size@conf)  | lessons shown to llm_lessons");
  for (let n = from; n <= cycles; n++) {
    const f = (arm) => (rows.find((x) => x.n === n && x.arm === arm)?.detail.trades ?? []).map((t) => `${t.asset} ${t.direction[0]} ${t.size}@${t.confidence}`).join(", ") || "-";
    const L = rows.find((x) => x.n === n && x.arm === "llm_lessons")?.detail.lessons ?? [];
    console.log(` c${String(n).padStart(2)} with: ${f("llm_lessons").padEnd(40)} without: ${f("llm_nolessons").padEnd(40)} lessons=${L.length}`);
  }
  // tag each closed trade of the lessons arm with what the lessons shown at its open cycle said about its asset/direction
  const tag = (openCycle, c) => {
    const L = rows.find((x) => x.n === openCycle && x.arm === "llm_lessons")?.detail.lessons ?? [];
    const m = L.find((l) => new RegExp(`${c.asset} ${c.dir}s? `).test(l));
    if (!m) return "no lesson";
    if (/lost|reduce/.test(m)) return "lesson said avoid";
    if (/won|trust/.test(m)) return "lesson said favour";
    const w = /(\d+) wins in (\d+)/.exec(m); return w ? (+w[1] / +w[2] < 0.4 ? "lesson said avoid" : +w[1] / +w[2] > 0.6 ? "lesson said favour" : "no lesson") : "no lesson";
  };
  const by = {};
  for (const c of sum.llm_lessons.closed_list) { const t = tag(c.heldFrom, c); (by[t] ??= { n: 0, wins: 0, pnl: 0 }); by[t].n++; by[t].wins += c.pnl > 0; by[t].pnl += c.pnl; }
  console.log("\nlessons arm closed trades by what the lessons said about them:", JSON.stringify(by));
  if (a.includes("--prompt")) console.log("last lessons shown:", JSON.stringify(rows.filter((x) => x.arm === "llm_lessons").at(-2)?.detail.lessons, null, 1));
  console.log(`run ${r.runId}`);
  if (!a.includes("--keep")) { await db.pool.query("delete from replay_runs where id=$1", [r.runId]); console.log("run row deleted"); }
  else console.log("kept");
  if (a.includes("--dump")) console.log(JSON.stringify(rows.filter((x) => x.arm === "llm_lessons").slice(0, 3).map((x) => x.detail)).slice(0, 3000));
} finally { await db.close(); }
