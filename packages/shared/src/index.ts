export type Direction = "long" | "short";

export interface Signal {
  asset: string;
  direction: Direction;
  magnitude: number; // 0..1
  horizon: string; // e.g. "4h", "3d"
  confidence: number; // 0..1
  source: string;
  url: string;
}

export interface Thesis {
  id: string;
  asset: string;
  direction: Direction;
  entry: number;
  size: number; // quote notional
  stop: number;
  target: number;
  rationale: string;
  confidence: number;
  signalIds: string[];
}

export interface GuardrailDecision {
  verdict: "allow" | "needs_approval" | "block";
  reasons: string[];
}

export interface TradeResult {
  thesisId: string;
  venue: "synthetic" | "testnet";
  fillPrice: number;
  qty: number;
  fee: number;
  ts: string;
}

export interface Preferences {
  allowedAssets: string[];
  bannedAssets: string[];
  maxPositionPct: number; // of wallet balance, 0..1
  approvalThresholdUsd: number; // orders above this need a human
  minConfidence: number; // below this needs a human
}

export interface GuardrailConfig {
  maxNotionalUsd: number;
  maxExposureUsd: number;
  dailyLossLimitUsd: number;
  maxOrdersPerHour: number;
}

export interface GuardrailState {
  walletUsd: number;
  openExposureUsd: number;
  dailyPnlUsd: number;
  ordersLastHour: number;
  killSwitch: boolean;
}

/** Venue abstraction: testnet exchange or the synthetic simulator behind one interface. */
export interface ExchangeAdapter {
  readonly venue: TradeResult["venue"];
  price(asset: string): Promise<number>;
  placeOrder(thesis: Thesis): Promise<TradeResult>;
}
