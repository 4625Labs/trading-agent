/** Records outbound integration calls. No sink set (tests, scripts) means no-op; the worker installs a DB sink. */
export interface UsageRecord {
  provider: "contextdev" | "anthropic" | "binance" | "omnara";
  endpoint: string;
  status?: number | null;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  detail?: Record<string, unknown>;
}

let sink: ((r: UsageRecord) => void) | null = null;

export function setUsageSink(fn: ((r: UsageRecord) => void) | null) {
  sink = fn;
}

export function recordUsage(r: UsageRecord) {
  try {
    sink?.(r);
  } catch {
    /* usage tracking must never break a call */
  }
}
