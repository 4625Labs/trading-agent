import test from "node:test";
import assert from "node:assert/strict";
import type { GuardrailState, Preferences, Thesis } from "@trading-agent/shared";
import { evaluate } from "./guardrails.ts";
import { Simulator } from "./simulator.ts";

const thesis: Thesis = { id: "t1", asset: "BTC", direction: "long", entry: 100, size: 100, stop: 95, target: 110, rationale: "", confidence: 0.8, signalIds: [] };
const prefs: Preferences = { allowedAssets: ["BTC", "ETH"], bannedAssets: [], maxPositionPct: 0.5, approvalThresholdUsd: 200, minConfidence: 0.5 };
const state: GuardrailState = { walletUsd: 1000, openExposureUsd: 0, dailyPnlUsd: 0, ordersLastHour: 0, killSwitch: false };

test("allows a normal order", () => assert.equal(evaluate(thesis, prefs, state).verdict, "allow"));
test("blocks on kill switch", () => assert.equal(evaluate(thesis, prefs, { ...state, killSwitch: true }).verdict, "block"));
test("blocks banned/unlisted asset", () => {
  assert.equal(evaluate({ ...thesis, asset: "DOGE" }, prefs, state).verdict, "block");
  assert.equal(evaluate(thesis, { ...prefs, bannedAssets: ["BTC"] }, state).verdict, "block");
});
test("blocks oversize, exposure, loss limit, rate limit", () => {
  assert.equal(evaluate({ ...thesis, size: 600 }, { ...prefs, maxPositionPct: 1 }, { ...state, walletUsd: 5000 }).verdict, "block");
  assert.equal(evaluate(thesis, prefs, { ...state, openExposureUsd: 1950 }).verdict, "block");
  assert.equal(evaluate(thesis, prefs, { ...state, dailyPnlUsd: -250 }).verdict, "block");
  assert.equal(evaluate(thesis, prefs, { ...state, ordersLastHour: 10 }).verdict, "block");
});
test("blocks stop on wrong side", () => assert.equal(evaluate({ ...thesis, stop: 105 }, prefs, state).verdict, "block"));
test("needs approval for big size or low confidence", () => {
  assert.equal(evaluate({ ...thesis, size: 300 }, prefs, { ...state, walletUsd: 5000 }).verdict, "needs_approval");
  assert.equal(evaluate({ ...thesis, confidence: 0.3 }, prefs, state).verdict, "needs_approval");
});

test("simulator fills with slippage and closes on target with net pnl", async () => {
  const sim = new Simulator(async () => 100, { slippageBps: 10, feeBps: 10 });
  const r = await sim.placeOrder(thesis);
  assert.ok(r.fillPrice > 100);
  assert.equal(sim.markToMarket({ BTC: 102 }).length, 0);
  const closed = sim.markToMarket({ BTC: 111 });
  assert.equal(closed[0].exitReason, "target");
  assert.ok(closed[0].pnl! > 0 && closed[0].pnl! < 11);
});
test("simulator short closes on stop with loss", async () => {
  const sim = new Simulator(async () => 100);
  await sim.placeOrder({ ...thesis, id: "s", direction: "short", stop: 105, target: 90 });
  const closed = sim.markToMarket({ BTC: 106 });
  assert.equal(closed[0].exitReason, "stop");
  assert.ok(closed[0].pnl! < 0);
});

import { BinanceTestnetAdapter, sign } from "./binance.ts";
test("binance signing matches the documented HMAC example", () => {
  // Example from Binance docs: secret NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j
  const q = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
  assert.equal(sign(q, "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"), "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
});
test("binance adapter rejects shorts and maps symbols", async () => {
  const a = new BinanceTestnetAdapter({ apiKey: "k", apiSecret: "s" });
  assert.equal(a.symbol("btc"), "BTCUSDT");
  await assert.rejects(() => a.placeOrder({ ...thesis, direction: "short" }), /short/);
});
