import type { Preferences } from "@trading-agent/shared";

export interface ProposedThesis {
  asset: string;
  direction: "long" | "short";
  size: number; // USD notional
  entry: number;
  stop: number;
  target: number;
  confidence: number;
  rationale: string;
  signalIds: string[];
  /** "real": long spot, can go to the testnet. "synthetic": shorts, simulator only. */
  venueHint: "real" | "synthetic";
}

export interface ValidateCtx {
  prices: Record<string, number>; // current price per asset
  prefs: Pick<Preferences, "allowedAssets" | "bannedAssets" | "maxPositionPct" | "minConfidence">;
  walletUsd: number;
  knownSignalIds: Set<string>;
}
export type ValidateResult = { ok: true; thesis: ProposedThesis } | { ok: false; reason: string };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/**
 * Pure validation of one model-proposed thesis. Entry is forced to the current price (never trusted from the model);
 * size is clamped to prefs.maxPositionPct * wallet; stop/target must sit on the correct sides of entry.
 */
export function validateThesis(raw: any, ctx: ValidateCtx): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const asset = String(raw.asset ?? "").trim().toUpperCase();
  if (!ctx.prefs.allowedAssets.includes(asset)) return { ok: false, reason: `asset ${asset || "?"} not allowed` };
  if (ctx.prefs.bannedAssets.includes(asset)) return { ok: false, reason: `asset ${asset} banned` };
  const direction = String(raw.direction ?? "").trim().toLowerCase();
  if (direction !== "long" && direction !== "short") return { ok: false, reason: "bad direction" };
  const price = ctx.prices[asset];
  if (!(typeof price === "number" && price > 0 && Number.isFinite(price))) return { ok: false, reason: `no current price for ${asset}` };
  const entry = price;
  const stop = num(raw.stop), target = num(raw.target), confidence = num(raw.confidence);
  let size = num(raw.size);
  if (![stop, target, confidence, size].every(Number.isFinite)) return { ok: false, reason: "non-numeric field" };
  if (confidence < 0 || confidence > 1) return { ok: false, reason: "confidence out of range" };
  if (confidence < ctx.prefs.minConfidence) return { ok: false, reason: `confidence ${confidence} below minConfidence` };
  if (direction === "long" ? !(stop < entry && entry < target) : !(target < entry && entry < stop)) return { ok: false, reason: "stop/target on wrong side of entry" };
  if (Math.abs(stop - entry) / entry > 0.25) return { ok: false, reason: "stop more than 25% from entry" };
  if (Math.abs(target - entry) / entry > 0.5) return { ok: false, reason: "target more than 50% from entry" };
  const cap = ctx.prefs.maxPositionPct * ctx.walletUsd;
  if (!(cap > 0)) return { ok: false, reason: "position cap is zero" };
  if (size <= 0) return { ok: false, reason: "size must be positive" };
  size = Math.round(Math.min(size, cap) * 100) / 100;
  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim().slice(0, 1000) : "";
  if (!rationale) return { ok: false, reason: "missing rationale" };
  const signalIds = (Array.isArray(raw.signalIds) ? raw.signalIds : []).map(String).filter((id: string) => ctx.knownSignalIds.has(id));
  if (!signalIds.length) return { ok: false, reason: "no valid signalIds" };
  return { ok: true, thesis: { asset, direction, size, entry, stop, target, confidence, rationale, signalIds: [...new Set(signalIds)] as string[], venueHint: direction === "long" ? "real" : "synthetic" } };
}
