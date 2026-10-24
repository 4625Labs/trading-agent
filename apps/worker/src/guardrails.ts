import type { GuardrailConfig, GuardrailDecision, GuardrailState, Preferences, Thesis } from "@trading-agent/shared";

export const DEFAULT_CONFIG: GuardrailConfig = {
  maxNotionalUsd: 500,
  maxExposureUsd: 2000,
  dailyLossLimitUsd: 200,
  maxOrdersPerHour: 10,
};

/** Deterministic policy between the agent and any real venue. The LLM never bypasses this. */
export function evaluate(
  t: Thesis,
  prefs: Preferences,
  state: GuardrailState,
  cfg: GuardrailConfig = DEFAULT_CONFIG,
): GuardrailDecision {
  const block: string[] = [];
  const ask: string[] = [];

  if (state.killSwitch) block.push("kill switch is on");
  if (prefs.bannedAssets.includes(t.asset)) block.push(`${t.asset} is banned by user`);
  if (prefs.allowedAssets.length && !prefs.allowedAssets.includes(t.asset)) block.push(`${t.asset} not in allowed assets`);
  if (!(t.size > 0)) block.push("size must be positive");
  if (t.size > cfg.maxNotionalUsd) block.push(`size ${t.size} exceeds max notional ${cfg.maxNotionalUsd}`);
  if (t.size > prefs.maxPositionPct * state.walletUsd) block.push("size exceeds user max position % of wallet");
  if (state.openExposureUsd + t.size > cfg.maxExposureUsd) block.push("total exposure limit exceeded");
  if (state.dailyPnlUsd <= -cfg.dailyLossLimitUsd) block.push("daily loss limit reached");
  if (state.ordersLastHour >= cfg.maxOrdersPerHour) block.push("order rate limit reached");
  const stopOk = t.direction === "long" ? t.stop < t.entry : t.stop > t.entry;
  const targetOk = t.direction === "long" ? t.target > t.entry : t.target < t.entry;
  if (!stopOk) block.push("stop is on the wrong side of entry");
  if (!targetOk) block.push("target is on the wrong side of entry");

  if (block.length) return { verdict: "block", reasons: block };

  if (t.size > prefs.approvalThresholdUsd) ask.push(`size ${t.size} above approval threshold ${prefs.approvalThresholdUsd}`);
  if (t.confidence < prefs.minConfidence) ask.push(`confidence ${t.confidence} below ${prefs.minConfidence}`);
  if (ask.length) return { verdict: "needs_approval", reasons: ask };

  return { verdict: "allow", reasons: [] };
}
