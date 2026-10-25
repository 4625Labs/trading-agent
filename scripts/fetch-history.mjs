// Downloads ~2 years of 4h klines for BTC/ETH/SOL from the public api.binance.us endpoint (no key), validates continuity,
// and caches compact [openTime,o,h,l,c] arrays in apps/worker/data/. Usage: node scripts/fetch-history.mjs [--days 730]
import { mkdirSync, writeFileSync, statSync } from "node:fs";
const args = process.argv.slice(2);
const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 730;
const STEP = 4 * 3600 * 1000;
const dir = new URL("../apps/worker/data/", import.meta.url);
mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const asset of ["BTC", "ETH", "SOL"]) {
  let start = Date.now() - days * 86400_000;
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`https://api.binance.us/api/v3/klines?symbol=${asset}USDT&interval=4h&limit=1000&startTime=${start}`);
    if (!res.ok) throw new Error(`${asset} klines ${res.status}`);
    const k = await res.json();
    if (!k.length) break;
    for (const c of k) rows.push([c[0], +c[1], +c[2], +c[3], +c[4]]);
    const next = k[k.length - 1][0] + STEP;
    if (k.length < 1000 || next > Date.now()) break;
    start = next;
    await sleep(400);
  }
  // dedupe + continuity check
  const seen = new Map(rows.map((r) => [r[0], r]));
  const out = [...seen.values()].sort((a, b) => a[0] - b[0]);
  let gaps = 0;
  for (let i = 1; i < out.length; i++) if (out[i][0] - out[i - 1][0] !== STEP) gaps++;
  const f = new URL(`klines-4h-${asset}.json`, dir);
  writeFileSync(f, JSON.stringify(out));
  console.log(`${asset}: ${out.length} candles ${new Date(out[0][0]).toISOString().slice(0, 10)} -> ${new Date(out.at(-1)[0]).toISOString().slice(0, 10)}, gaps=${gaps}, ${(statSync(f).size / 1024).toFixed(0)} KB`);
}
