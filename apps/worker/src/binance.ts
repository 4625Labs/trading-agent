import { createHmac } from "node:crypto";
import type { ExchangeAdapter, Thesis, TradeResult } from "@trading-agent/shared";

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  quote?: string; // quote asset for symbols, e.g. USDT
}

interface Fill { price: string; qty: string; commission: string; commissionAsset: string }

export function sign(query: string, secret: string) {
  return createHmac("sha256", secret).update(query).digest("hex");
}

/** Binance.US testnet spot adapter. Spot only: shorts are rejected, closing is a market sell of the held qty. */
export class BinanceTestnetAdapter implements ExchangeAdapter {
  readonly venue = "testnet" as const;
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private quote: string;

  constructor(cfg: BinanceConfig) {
    this.apiKey = cfg.apiKey;
    this.apiSecret = cfg.apiSecret;
    this.baseUrl = cfg.baseUrl ?? "https://api.testnet.binance.us";
    this.quote = cfg.quote ?? "USDT";
  }

  static fromEnv(env: Record<string, string | undefined> = process.env) {
    if (!env.EXCHANGE_TESTNET_API_KEY || !env.EXCHANGE_TESTNET_API_SECRET) throw new Error("missing testnet API credentials");
    return new BinanceTestnetAdapter({ apiKey: env.EXCHANGE_TESTNET_API_KEY, apiSecret: env.EXCHANGE_TESTNET_API_SECRET, baseUrl: env.EXCHANGE_TESTNET_URL });
  }

  symbol(asset: string) {
    return `${asset.toUpperCase()}${this.quote}`;
  }

  private async request(method: "GET" | "POST", path: string, params: Record<string, string | number> = {}, signed = false) {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    if (signed) {
      q.set("timestamp", String(Date.now()));
      q.set("recvWindow", "5000");
      q.set("signature", sign(q.toString(), this.apiSecret));
    }
    const res = await fetch(`${this.baseUrl}${path}?${q}`, { method, headers: { "X-MBX-APIKEY": this.apiKey } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`binance ${method} ${path} -> ${res.status} ${body.msg ?? ""}`.trim());
    return body;
  }

  async price(asset: string) {
    const r = await this.request("GET", "/api/v3/ticker/price", { symbol: this.symbol(asset) });
    return Number(r.price);
  }

  async freeBalance(asset: string) {
    const acct = await this.request("GET", "/api/v3/account", {}, true);
    return Number(acct.balances.find((b: { asset: string }) => b.asset === asset.toUpperCase())?.free ?? 0);
  }

  private summarize(thesisId: string, order: { fills?: Fill[]; transactTime?: number }, side: "BUY" | "SELL"): TradeResult {
    const fills = order.fills ?? [];
    const qty = fills.reduce((s, f) => s + Number(f.qty), 0);
    const quoteSpent = fills.reduce((s, f) => s + Number(f.qty) * Number(f.price), 0);
    // Commission is charged in base (BUY) or quote (SELL) or BNB; convert to quote terms where possible.
    const fee = fills.reduce((s, f) => {
      const c = Number(f.commission);
      const px = Number(f.price);
      return s + (f.commissionAsset === this.quote ? c : f.commissionAsset === "BNB" ? 0 : side === "BUY" ? c * px : c);
    }, 0);
    return { thesisId, venue: "testnet", fillPrice: qty ? quoteSpent / qty : 0, qty, fee, ts: new Date(order.transactTime ?? Date.now()).toISOString() };
  }

  /** Market buy of `thesis.size` quote notional. */
  async placeOrder(t: Thesis): Promise<TradeResult> {
    if (t.direction !== "long") throw new Error("spot venue does not support short theses");
    const order = await this.request("POST", "/api/v3/order", {
      symbol: this.symbol(t.asset),
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: t.size.toFixed(2),
      newOrderRespType: "FULL",
    }, true);
    return this.summarize(t.id, order, "BUY");
  }

  /** Market sell of a base quantity (rounded down to the 5-decimal lot step). */
  async closePosition(thesisId: string, asset: string, qty: number): Promise<TradeResult> {
    const q = Math.floor(qty * 1e5) / 1e5;
    const order = await this.request("POST", "/api/v3/order", {
      symbol: this.symbol(asset),
      side: "SELL",
      type: "MARKET",
      quantity: q.toFixed(5),
      newOrderRespType: "FULL",
    }, true);
    return this.summarize(thesisId, order, "SELL");
  }
}
