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
