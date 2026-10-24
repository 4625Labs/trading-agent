export const ASSETS = ["BTC", "ETH", "SOL"] as const;
export const DEFAULT_CONFIG = { enabled: false, intervalSeconds: 300, assets: ["BTC", "ETH", "SOL"] as string[], confidenceBar: 0.5, maxTradesPerCycle: 1, tradeSizeUsd: 25, realOrders: false };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function num(v: unknown, name: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}
/** Strict type validation, then clamping to the ranges the worker uses. Returns config or an error message. */
export function validateConfig(b: any): typeof DEFAULT_CONFIG | string {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "invalid body";
  try {
    if (typeof b.enabled !== "boolean") return "enabled must be true or false";
    if (typeof b.realOrders !== "boolean") return "realOrders must be true or false";
    if (!Array.isArray(b.assets) || b.assets.length === 0 || b.assets.length > 3) return "assets must be a non-empty subset of BTC, ETH, SOL";
    const assets = [...new Set(b.assets.map((a: unknown) => String(a).toUpperCase()))] as string[];
    if (assets.some((a) => !(ASSETS as readonly string[]).includes(a))) return "assets must be a subset of BTC, ETH, SOL";
    return {
      enabled: b.enabled,
      intervalSeconds: Math.round(clamp(num(b.intervalSeconds, "intervalSeconds"), 60, 86400)),
      assets,
      confidenceBar: clamp(num(b.confidenceBar, "confidenceBar"), 0.2, 0.95),
      maxTradesPerCycle: Math.round(clamp(num(b.maxTradesPerCycle, "maxTradesPerCycle"), 1, 5)),
      tradeSizeUsd: clamp(num(b.tradeSizeUsd, "tradeSizeUsd"), 5, 500),
      realOrders: b.realOrders,
    };
  } catch (e) { return (e as Error).message; }
}
