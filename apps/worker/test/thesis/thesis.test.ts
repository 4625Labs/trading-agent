import test from "node:test";
import assert from "node:assert/strict";
import { validateThesis, buildThesisPrompt, generateTheses, proposeToAgent, proposalText } from "../../src/thesis/index.ts";

const prefs = { allowedAssets: ["BTC", "ETH", "SOL"], bannedAssets: [] as string[], maxPositionPct: 0.05, approvalThresholdUsd: 25, minConfidence: 0.5 };
const ctx = { prices: { BTC: 80000, ETH: 3000 }, prefs, walletUsd: 1000, knownSignalIds: new Set(["a", "b"]) };
const t = { asset: "BTC", direction: "long", size: 40, entry: 12345, stop: 78000, target: 85000, confidence: 0.7, rationale: "r", signalIds: ["a", "zz"] };

test("entry forced to current price, size clamped, unknown signal ids dropped", () => {
  const v = validateThesis(t, ctx);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.thesis.entry, 80000); assert.equal(v.thesis.size, 40);
  assert.deepEqual(v.thesis.signalIds, ["a"]); assert.equal(v.thesis.venueHint, "real");
  const big = validateThesis({ ...t, size: 9999 }, ctx);
  assert.ok(big.ok && big.thesis.size === 50);
});
test("rejects wrong sides, low confidence, banned, no signals", () => {
  assert.equal(validateThesis({ ...t, stop: 81000 }, ctx).ok, false);
  assert.equal(validateThesis({ ...t, target: 79000 }, ctx).ok, false);
  assert.equal(validateThesis({ ...t, confidence: 0.2 }, ctx).ok, false);
  assert.equal(validateThesis({ ...t, signalIds: ["zz"] }, ctx).ok, false);
  assert.equal(validateThesis(t, { ...ctx, prefs: { ...prefs, bannedAssets: ["BTC"] } }).ok, false);
  assert.equal(validateThesis({ ...t, asset: "SOL" }, ctx).ok, false); // no price
  assert.equal(validateThesis({ ...t, size: "abc" }, ctx).ok, false);
});
test("short: sides inverted and synthetic hint", () => {
  const s = { ...t, direction: "short", stop: 82000, target: 75000 };
  const v = validateThesis(s, ctx);
  assert.ok(v.ok && v.thesis.venueHint === "synthetic");
  assert.equal(validateThesis({ ...s, stop: 78000 }, ctx).ok, false);
});
const sig = { id: "a", asset: "BTC", direction: "long", magnitude: 0.6, horizon: "1d", confidence: 0.8, url: "u", source_name: "coindesk.com", rationale: "ETF inflows", weight: 1.2 };
test("prompt includes lessons, source weights, prices, max position", () => {
  const p = buildThesisPrompt({ signals: [sig], prefs, lessons: ["Avoid SOL shorts on weekends"], prices: { BTC: 80000 }, walletUsd: 1000 });
  assert.match(p, /Avoid SOL shorts on weekends/); assert.match(p, /source_weight=1\.20/);
  assert.match(p, /BTC=80000/); assert.match(p, /max position USD=50/); assert.match(p, /id=a/);
});
test("generateTheses offline with injected llm; drops invalid", async () => {
  let seenPrompt = "";
  const out = await generateTheses({
    llm: async (r) => { seenPrompt = r.prompt; return "```json\n" + JSON.stringify({ theses: [t, { ...t, stop: 99999 }] }) + "\n```"; },
    readSignals: async () => [sig], prefs: async () => prefs, lessons: async () => ["L1"], price: async () => 80000, walletUsd: 1000,
  });
  assert.equal(out.length, 1); assert.match(seenPrompt, /L1/);
});
test("generateTheses empty without signals; proposeToAgent sends exact fields", async () => {
  assert.deepEqual(await generateTheses({ llm: async () => "", readSignals: async () => [], prefs: async () => prefs, lessons: async () => [], price: async () => 1, walletUsd: 1 }), []);
  const v = validateThesis(t, ctx); assert.ok(v.ok); if (!v.ok) return;
  let sent = "";
  await proposeToAgent({ send: async (_a: string, text: string) => { sent = text; } } as any, "ag", v.thesis);
  assert.equal(sent, proposalText(v.thesis)); assert.match(sent, /"entry":80000/); assert.match(sent, /place_order/);
});

test("prompt splits user preferences from learner observations; caps 3, drops n<8 and legacy directive rows", () => {
  const p = buildThesisPrompt({
    signals: [sig], prefs, prices: { BTC: 80000 }, walletUsd: 1000,
    lessons: [
      { text: "Keep SOL positions small", origin: "human_feedback" },
      { text: "Observed 2 wins in 16 resolved ETH long trades; more losses than wins, still a small sample.", origin: "learner" },
      { text: "Observed 20 wins in 23 resolved BTC short trades; suggestive but still a small sample.", origin: "learner" },
      { text: "Observed 5 wins in 7 resolved SOL long trades; not statistically significant, may be chance.", origin: "learner" },
      { text: "Observed 9 wins in 16 resolved BTC long trades; not statistically significant, may be chance.", origin: "learner" },
      { text: "Observed 12 wins in 20 resolved ETH short trades; not statistically significant, may be chance.", origin: "learner" },
      { text: "BTC longs from source x lost 4/5 (net -1 USD); reduce size or skip.", origin: "learner" },
    ],
  });
  const [prefsPart, obsPart] = p.split("OBSERVATIONS SO FAR");
  assert.match(prefsPart, /Keep SOL positions small/);
  assert.ok(!/Observed/.test(prefsPart));
  const obsLines = obsPart.split("\n").filter((l) => l.startsWith("- Observed"));
  assert.equal(obsLines.length, 3);
  assert.match(obsLines[0], /20 wins in 23/); // strongest evidence first
  assert.ok(!/7 resolved SOL/.test(obsPart)); // n<8 gate
  assert.ok(!/reduce size|skip/.test(p.split("SIGNALS")[0]));
  assert.match(p, /do NOT use them to increase size or the number of trades/);
});
test("plain-string callers: observation-format strings are split out, legacy directive strings dropped", () => {
  const p = buildThesisPrompt({ signals: [sig], prefs, prices: { BTC: 1 }, walletUsd: 1000, lessons: ["Avoid SOL shorts", "Observed 10 wins in 10 resolved BTC short trades; suggestive but still a small sample.", "ETH shorts lost 4/5; reduce size or skip."] });
  assert.match(p.split("OBSERVATIONS SO FAR")[0], /Avoid SOL shorts/);
  assert.match(p.split("OBSERVATIONS SO FAR")[1], /Observed 10 wins/);
  assert.ok(!/reduce size/.test(p));
});
test("generateTheses prefers lessonRows with origin", async () => {
  let seen = "";
  await generateTheses({ llm: async (r) => { seen = r.prompt; return '{"theses":[]}'; }, readSignals: async () => [sig], prefs: async () => prefs, lessons: async () => ["SHOULD NOT APPEAR"], lessonRows: async () => [{ text: "User likes BTC", origin: "human_feedback" }], price: async () => 80000, walletUsd: 1000 });
  assert.match(seen, /User likes BTC/);
  assert.ok(!/SHOULD NOT APPEAR/.test(seen));
});
