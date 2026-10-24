import type { ExchangeAdapter, Thesis, TradeResult } from "@trading-agent/shared";

export interface SimConfig {
  slippageBps: number;
  feeBps: number;
}
export const DEFAULT_SIM: SimConfig = { slippageBps: 5, feeBps: 10 };

export interface SimPosition {
  thesis: Thesis;
  fillPrice: number;
  qty: number;
  entryFee: number;
  status: "open" | "closed";
  exitPrice?: number;
  exitReason?: "stop" | "target" | "manual";
  pnl?: number; // net of fees
}

/** Pure paper-trading engine: fills at live price with slippage + fees, closes on stop/target. */
export class Simulator implements ExchangeAdapter {
  readonly venue = "synthetic" as const;
  positions = new Map<string, SimPosition>();

  private getPrice: (asset: string) => Promise<number>;
  private cfg: SimConfig;
  private now: () => Date;

  constructor(getPrice: (asset: string) => Promise<number>, cfg: SimConfig = DEFAULT_SIM, now: () => Date = () => new Date()) {
    this.getPrice = getPrice;
    this.cfg = cfg;
    this.now = now;
  }

  price(asset: string) {
    return this.getPrice(asset);
  }

  async placeOrder(t: Thesis): Promise<TradeResult> {
    const mid = await this.getPrice(t.asset);
    const slip = (this.cfg.slippageBps / 1e4) * (t.direction === "long" ? 1 : -1);
    const fillPrice = mid * (1 + slip);
    const qty = t.size / fillPrice;
    const fee = t.size * (this.cfg.feeBps / 1e4);
    this.positions.set(t.id, { thesis: t, fillPrice, qty, entryFee: fee, status: "open" });
    return { thesisId: t.id, venue: "synthetic", fillPrice, qty, fee, ts: this.now().toISOString() };
  }

  /** Mark open positions to market; close any that hit stop or target. Returns the positions closed. */
  markToMarket(prices: Record<string, number>): SimPosition[] {
    const closed: SimPosition[] = [];
    for (const p of this.positions.values()) {
      if (p.status !== "open") continue;
      const px = prices[p.thesis.asset];
      if (px === undefined) continue;
      const long = p.thesis.direction === "long";
      const hitStop = long ? px <= p.thesis.stop : px >= p.thesis.stop;
      const hitTarget = long ? px >= p.thesis.target : px <= p.thesis.target;
      if (hitStop || hitTarget) closed.push(this.close(p, px, hitStop ? "stop" : "target"));
    }
    return closed;
  }

  close(p: SimPosition, px: number, reason: SimPosition["exitReason"]): SimPosition {
    const long = p.thesis.direction === "long";
    const slip = (this.cfg.slippageBps / 1e4) * (long ? -1 : 1);
    const exit = px * (1 + slip);
    const gross = (long ? exit - p.fillPrice : p.fillPrice - exit) * p.qty;
    const exitFee = exit * p.qty * (this.cfg.feeBps / 1e4);
    p.status = "closed";
    p.exitPrice = exit;
    p.exitReason = reason;
    p.pnl = gross - p.entryFee - exitFee;
    return p;
  }

  totalPnl() {
    return [...this.positions.values()].reduce((s, p) => s + (p.pnl ?? 0), 0);
  }
}
