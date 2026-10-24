export const RECENT_PENDING_SQL = "select 1 from commands where kind=$1 and status='pending' and created_at > now() - interval '10 seconds' limit 1";
/** Strict whitelist validation; returns the normalized command or an error message. */
export function validateCommand(b: any): { kind: string; payload: Record<string, unknown> } | string {
  if (!b || typeof b !== "object") return "invalid body";
  if (b.kind === "demo_idea") return { kind: "demo_idea", payload: {} };
  if (b.kind === "demo_price_move") {
    const o = b.payload?.outcome;
    if (o !== "target" && o !== "stop") return "outcome must be target or stop";
    return { kind: "demo_price_move", payload: { outcome: o } };
  }
  return "unknown command kind";
}
