import { q } from "@/lib/db";
import { HttpError, UUID, body, handle, num } from "@/lib/http";
import { classify } from "@/lib/match";
import { openInteractions, resolveFor } from "@/lib/omnara";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const [rows, open] = await Promise.all([
      q(`select a.id approval_id, a.created_at requested_at, t.id thesis_id, t.asset,t.direction,t.entry,t.size,t.stop,t.target,t.rationale,t.confidence
         from approvals a join theses t on t.id=a.thesis_id where a.status='pending' order by a.created_at desc limit 50`),
      openInteractions(),
    ]);
    const approvalIds = new Set<string>();
    for (const { it } of open.items) {
      const c = classify(it);
      if (c.kind === "approval") approvalIds.add(c.thesisId!);
    }
    return {
      omnaraError: open.error ?? null,
      approvals: rows.map((r) => ({ ...r, entry: num(r.entry), size: num(r.size), stop: num(r.stop), target: num(r.target), confidence: num(r.confidence), questionOpen: approvalIds.has(r.thesis_id) }))
    };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    const kind = "approval" as const;
    if (b.kind !== "approval") throw new HttpError(400, "kind must be approval");
    if (typeof b.thesisId !== "string" || !UUID.test(b.thesisId)) throw new HttpError(400, "invalid thesisId");
    const choice = String(b.choice ?? "");
    if (kind === "approval" && !["approve", "reject"].includes(choice)) throw new HttpError(400, "choice must be approve or reject");
    {
      const p = await q("select 1 from approvals where thesis_id=$1 and status='pending' limit 1", [b.thesisId]);
      if (!p.length) throw new HttpError(409, "no pending approval for this thesis");
    }
    let r;
    try { r = await resolveFor(b.thesisId, kind, choice); }
    catch { throw new HttpError(502, "could not reach Omnara"); }
    if (!r.ok) throw new HttpError(404, r.error!);
    return { ok: true, sent: true };
  });
}
