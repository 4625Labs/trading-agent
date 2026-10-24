import test from "node:test";
import assert from "node:assert/strict";
import { sourceStats } from "../../src/learning/stats.ts";
import { updateSourceWeights, targetWeight, weightedVote } from "../../src/learning/weights.ts";
import { brier, fitCalibration, confidenceAdjust, reliabilityBins } from "../../src/learning/calibration.ts";
import { lessonsFromTradesV1 as lessonsFromTrades, lessonsFromTrades as liveLessons, observationText, topObservations } from "../../src/learning/lessons.ts";
import type { ClosedTrade } from "../../src/learning/types.ts";

const tr = (pnl: number, src = "X", dir: "long" | "short" = "long", asset = "SOL", sigDir = dir): ClosedTrade => ({ thesisId: Math.random().toString(), asset, direction: dir, confidence: 0.8, pnl, signals: [{ sourceId: src, direction: sigDir, confidence: 0.8 }] });

test("sourceStats: hit rate and avg pnl, contrarian credit, breakeven skipped", () => {
  const s = sourceStats([tr(10), tr(-5), tr(10), tr(0), tr(-4, "Y", "long", "SOL", "short")]);
  assert.equal(s.X.trials, 3);
  assert.equal(s.X.hits, 2);
  assert.ok(Math.abs(s.X.avgPnl - 5) < 1e-9);
  assert.equal(s.Y.hits, 1); // disagreed with a losing trade => right
  assert.equal(s.Y.totalPnl, 4);
});
test("weights: monotone in hit rate, bounded, sources without stats unchanged", () => {
  assert.ok(targetWeight({ hits: 8, trials: 10 }) > targetWeight({ hits: 5, trials: 10 }));
  assert.equal(targetWeight({ hits: 0, trials: 0 }), 1);
  const o = { lr: 1, floor: 0.2, cap: 1.5 };
  const w = updateSourceWeights({ a: 1, b: 1, c: 0.7 }, { a: { trials: 100, hits: 100, hitRate: 1, avgPnl: 1, totalPnl: 100 }, b: { trials: 100, hits: 0, hitRate: 0, avgPnl: -1, totalPnl: -100 } }, o);
  assert.equal(w.a, 1.5);
  assert.equal(w.b, 0.2);
  assert.equal(w.c, 0.7);
});
test("weightedVote", () => {
  const sigs = [{ sourceId: "a", direction: "long" as const, confidence: 1 }, { sourceId: "b", direction: "short" as const, confidence: 1 }];
  assert.ok(weightedVote(sigs, { a: 2, b: 1 }) > 0);
  assert.ok(weightedVote(sigs, { a: 1, b: 2 }) < 0);
});
test("calibration: brier, bins, adjust pulls overconfidence toward base rate", () => {
  assert.equal(brier([{ confidence: 1, outcome: 1 }, { confidence: 0, outcome: 0 }]), 0);
  assert.equal(brier([{ confidence: 1, outcome: 0 }]), 1);
  const pts = Array.from({ length: 100 }, (_, i) => ({ confidence: 0.9, outcome: (i < 50 ? 1 : 0) as 0 | 1 }));
  const m = fitCalibration(pts);
  assert.equal(reliabilityBins(pts)[4].n, 100);
  const adj = confidenceAdjust(m, 0.9);
  assert.ok(adj > 0.45 && adj < 0.6, String(adj));
  assert.equal(confidenceAdjust(null, 0.9), 0.9);
  assert.equal(confidenceAdjust(fitCalibration(pts.slice(0, 5)), 0.9), 0.9); // too little data
});
test("lessons: deterministic, thresholded", () => {
  const trades = [tr(-1), tr(-1), tr(-1), tr(-1), tr(2), tr(5, "W"), tr(5, "W"), tr(5, "W"), tr(5, "W"), tr(5, "W")];
  const l = lessonsFromTrades(trades, { minTrials: 5, loseRate: 0.6, winRate: 0.8, sourceLabel: (s) => `src-${s}` });
  assert.equal(l.length, 2);
  assert.match(l[0].text, /SOL longs from source src-W won 5\/5/);
  assert.match(l[1].text, /SOL longs from source src-X lost 4\/5.*reduce size/);
  assert.deepEqual(l, lessonsFromTrades(trades, { minTrials: 5, loseRate: 0.6, winRate: 0.8, sourceLabel: (s) => `src-${s}` }));
  assert.equal(lessonsFromTrades(trades.slice(0, 3)).length, 0);
});

const mt = (pnl: number, asset: string, dir: "long" | "short", sigs: [string, "long" | "short"][]): ClosedTrade => ({ thesisId: Math.random().toString(), asset, direction: dir, confidence: 0.6, pnl, signals: sigs.map(([sourceId, direction]) => ({ sourceId, direction, confidence: 0.6 })) });
test("observationText wording: below 50% says more losses than wins, never 'suggestive'", () => {
  assert.match(observationText("BTC long trades", 2, 16), /more losses than wins, still a small sample/);
  assert.match(observationText("BTC long trades", 5, 12), /more losses than wins, not statistically significant/);
  assert.match(observationText("BTC long trades", 20, 23), /suggestive but still a small sample/);
  assert.match(observationText("BTC long trades", 7, 12), /not statistically significant, may be chance/);
  assert.ok(!/reduce|avoid|skip|should|must/i.test(observationText("x", 1, 10)));
});
test("live lessons: min sample 8, agreeing sources only, identical stats collapse, ranked, no imperatives", () => {
  const trades = [
    ...Array.from({ length: 10 }, () => mt(1, "BTC", "short", [["a", "short"], ["b", "short"], ["c", "long"]])), // c disagreed with winning trades
    ...Array.from({ length: 7 }, () => mt(-1, "SOL", "long", [["d", "long"]])), // n=7 gated
  ];
  const L = liveLessons(trades);
  assert.equal(L.filter((l) => /SOL/.test(l.text)).length, 0);
  const ad = L.find((l) => l.key === "ad:BTC:short")!;
  assert.match(ad.text, /Observed 10 wins in 10 resolved BTC short trades.*sources that agreed: a, b\)/);
  const src = L.filter((l) => l.key.startsWith("src:"));
  assert.equal(src.length, 1); // a and b have identical stats -> one lesson
  assert.match(src[0].text, /each of the sources a, b agreed/);
  assert.ok(!L.some((l) => /\bc\b.*agreed|source c/.test(l.text)));
  assert.ok(L.every((l) => !/reduce|avoid|skip|trust it more/i.test(l.text)));
  assert.deepEqual(L, liveLessons(trades));
  assert.equal(liveLessons(trades.slice(0, 7)).length, 0);
});
test("topObservations: n gate, rank, cap, dedupe", () => {
  const t = ["Observed 5 wins in 6 resolved a; x.", "Observed 9 wins in 10 resolved b; x.", "Observed 9 wins in 10 resolved b; x.", "Observed 6 wins in 12 resolved c; x.", "Observed 1 wins in 9 resolved d; x.", "Observed 3 wins in 9 resolved e; x.", "junk"];
  const r = topObservations(t);
  assert.equal(r.length, 3);
  assert.match(r[0], /resolved d|resolved b/);
  assert.ok(!r.some((x) => /resolved a;/.test(x)));
});
