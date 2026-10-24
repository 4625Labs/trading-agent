// Client-safe helpers turning agent_events into plain-English sentences.
export interface Ev { id: string; ts: string; kind: string; title?: string; detail?: any; thesis_id?: string | null; agent_id?: string | null }
const n = (x: any) => (typeof x === "number" ? x : x === null || x === undefined || x === "" ? undefined : Number(x));
const money = (x: any) => { const v = n(x); return v === undefined || Number.isNaN(v) ? "" : "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
const price = (x: any) => { const v = n(x); return v === undefined || Number.isNaN(v) ? "?" : v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 4 : 2 }); };
const plural = (c: number, w: string) => `${c} ${w}${c === 1 ? "" : "s"}`;

export const KIND: Record<string, { icon: string; label: string; tone: string }> = {
  ingest: { icon: "news", label: "News", tone: "info" },
  signal: { icon: "radio", label: "Signal", tone: "info" },
  thesis_proposed: { icon: "bulb", label: "Idea", tone: "idea" },
  guardrail: { icon: "safety", label: "Safety check", tone: "warn" },
  approval_requested: { icon: "hand", label: "Needs you", tone: "warn" },
  approval_decided: { icon: "approvals", label: "Decision", tone: "pos" },
  order_executed: { icon: "coins", label: "Trade", tone: "pos" },
  position_closed: { icon: "flag", label: "Closed", tone: "idea" },
  feedback: { icon: "chat", label: "Feedback", tone: "info" },
  learning: { icon: "learning", label: "Learning", tone: "idea" },
  error: { icon: "alert", label: "Problem", tone: "neg" },
};
export const kindOf = (k: string) => KIND[k] ?? { icon: "info", label: k, tone: "info" };

export function sentence(e: Ev): string {
  const d = e.detail ?? {};
  const side = (s?: string) => (String(s).toLowerCase() === "short" ? "short" : "long");
  switch (e.kind) {
    case "ingest": {
      const a = n(d.articles) ?? 0, ins = n(d.inserted) ?? 0;
      return `Read ${plural(a, "news article")}, found ${plural(ins, "new signal")}` + (n(d.duplicates) ? ` (${n(d.duplicates)} already known)` : "") + (n(d.errors) ? `, ${plural(n(d.errors)!, "error")}` : "");
    }
    case "signal": return `Spotted a signal: ${d.asset ?? "?"} looks ${String(d.direction).toLowerCase() === "short" ? "bearish" : "bullish"}` + (n(d.confidence) !== undefined ? ` (${Math.round(n(d.confidence)! * 100)}% confident)` : "") + (d.source_name ? ` via ${d.source_name}` : "");
    case "thesis_proposed": return `Idea: ${side(d.direction)} ${d.asset ?? "?"} ${money(d.size)}` + (d.rationale ? `, because ${String(d.rationale).replace(/^because\s+/i, "")}` : "");
    case "guardrail": {
      const r = Array.isArray(d.reasons) && d.reasons.length ? ` because ${d.reasons.join("; ")}` : "";
      return d.verdict === "allow" ? "Safety check: passed, no rules in the way" : d.verdict === "block" ? `Safety check: blocked${r}` : `Safety check: needs your approval${r}`;
    }
    case "approval_requested": return "Asked you for approval";
    case "approval_decided": {
      const s = String(d.status ?? d.answer ?? "").toLowerCase();
      return s.startsWith("approv") ? "You approved" : s.startsWith("reject") ? "You rejected" : `Decision recorded${d.status ? `: ${d.status}` : ""}`;
    }
    case "order_executed": {
      const s = d.synthetic?.fillPrice;
      const real = d.real ? `real exchange filled at ${price(d.real.fillPrice)}` : d.realNote ? `real exchange skipped (${String(d.realNote).replace(/^no real venue configured$/, "not connected")})` : "";
      return `Practice trade filled at ${price(s)}` + (real ? `; ${real}` : "");
    }
    case "position_closed": {
      const p = n(d.pnl);
      return `Position closed at ${d.reason === "stop" ? "stop-loss" : d.reason === "target" ? "profit target" : d.reason ?? "exit"}` + (d.exitPrice !== undefined ? ` (${price(d.exitPrice)})` : "") + (p !== undefined ? `, ${p >= 0 ? "gain" : "loss"} ${money(Math.abs(p))}` : "");
    }
    case "feedback": return `You rated this: ${d.answer ?? "feedback received"}`;
    case "learning": return `Learned from ${plural(n(d.closedTrades) ?? 0, "closed trade")}` + (n(d.lessons) !== undefined ? `, ${plural(n(d.lessons)!, "lesson")}` : "") + (n(d.brier) !== undefined ? `, calibration score ${n(d.brier)!.toFixed(2)}` : "");
    case "error": return `Something went wrong: ${d.message ?? e.title ?? "unknown error"}`;
    default: return e.title || e.kind;
  }
}
