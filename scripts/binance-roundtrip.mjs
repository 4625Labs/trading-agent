// Testnet roundtrip: buy ~$15 BTC then sell it back. Prints prices/qty only.
import { BinanceTestnetAdapter } from "../apps/worker/src/binance.ts";
const a = BinanceTestnetAdapter.fromEnv();
const px = await a.price("BTC");
console.log("BTC price ok:", px > 0, "usdt free>0:", (await a.freeBalance("USDT")) > 0);
const buy = await a.placeOrder({ id: "rt", asset: "BTC", direction: "long", entry: px, size: 15, stop: px * 0.95, target: px * 1.05, rationale: "", confidence: 1, signalIds: [] });
console.log("BUY ", { fillPrice: buy.fillPrice.toFixed(2), qty: buy.qty, fee: buy.fee.toFixed(4) });
const sell = await a.closePosition("rt", "BTC", buy.qty);
console.log("SELL", { fillPrice: sell.fillPrice.toFixed(2), qty: sell.qty, fee: sell.fee.toFixed(4) });
console.log("roundtrip pnl (approx USDT):", ((sell.fillPrice - buy.fillPrice) * sell.qty - buy.fee - sell.fee).toFixed(4));
