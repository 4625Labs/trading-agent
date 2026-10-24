export interface SignalRef {
  sourceId: string;
  direction: "long" | "short";
  confidence: number;
}
/** A closed trade with the signals that backed it. pnl is net of fees. */
export interface ClosedTrade {
  thesisId: string;
  asset: string;
  direction: "long" | "short";
  confidence: number; // stated thesis confidence 0..1
  pnl: number;
  signals: SignalRef[];
  closedAt?: string;
}
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
