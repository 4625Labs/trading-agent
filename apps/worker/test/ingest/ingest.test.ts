import test from "node:test";
import assert from "node:assert/strict";
import { parseSignals, validateSignal, dedupeSignals, extractSignals, parseJsonLoose, runIngest } from "../../src/ingest/index.ts";

const art = { url: "https://www.coindesk.com/a", title: "t", markdown: "BTC to the moon" };
const good = { asset: "btc", direction: "LONG", magnitude: 1.7, horizon: "1d", confidence: -2, rationale: "ETF inflows" };

test("validate clamps and normalizes", () => {
  const s = validateSignal(good, art)!;
  assert.equal(s.asset, "BTC"); assert.equal(s.direction, "long");
  assert.equal(s.magnitude, 1); assert.equal(s.confidence, 0); assert.equal(s.source, "coindesk.com");
});
test("validate drops malformed", () => {
  assert.equal(validateSignal({ ...good, asset: "DOGE" }, art), null);
  assert.equal(validateSignal({ ...good, direction: "up" }, art), null);
  assert.equal(validateSignal({ ...good, magnitude: "x" }, art), null);
  assert.equal(validateSignal({ ...good, rationale: "" }, art), null);
  assert.equal(validateSignal(null, art), null);
});
test("parseSignals tolerates fences and garbage", () => {
  assert.equal(parseSignals("```json\n" + JSON.stringify({ signals: [good, { bad: 1 }] }) + "\n```", art).length, 1);
  assert.deepEqual(parseSignals("no json here", art), []);
  assert.equal(parseSignals(JSON.stringify([good]), art).length, 1);
  assert.deepEqual(parseJsonLoose('x {"a":1} y'), { a: 1 });
});
test("dedupe by url+asset", () => {
  const s = validateSignal(good, art)!;
  assert.equal(dedupeSignals([s, { ...s }, { ...s, asset: "ETH" }]).length, 2);
});
test("runIngest end to end offline with dedupe across runs", async () => {
  const hashes = new Set<string>();
  const store = {
    seedSources: async () => {}, sourceFor: async () => ({ id: "s1", weight: 1 }),
    insertSignal: async (s: any) => { const k = s.url + s.asset; if (hashes.has(k)) return null; hashes.add(k); return "id" + hashes.size; },
  };
  const llm = async () => JSON.stringify({ signals: [good] });
  const deps = { store, llm, ctx: { search: async () => [art, art] }, queries: [{ asset: "BTC", query: "q" }] };
  const r1 = await runIngest(deps);
  assert.equal(r1.inserted, 1); assert.equal(r1.articles, 1);
  const r2 = await runIngest(deps);
  assert.equal(r2.inserted, 0); assert.equal(r2.duplicates, 1);
});
test("extractSignals uses injected llm", async () => {
  const out = await extractSignals(async () => JSON.stringify({ signals: [good] }), art);
  assert.equal(out.length, 1);
});
