import { q } from "@/lib/db";
import { HttpError, UUID, body, handle, num } from "@/lib/http";
import { FEEDBACK_LABELS, classify, promptOf, labelsOf } from "@/lib/match";
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
    const feedback: { thesisId: string; prompt: string; options: string[]; asset?: string }[] = [];
    for (const { it } of open.items) {
      const c = classify(it);
      if (c.kind === "approval") approvalIds.add(c.thesisId!);
      if (c.kind === "feedback") feedback.push({ thesisId: c.thesisId!, prompt: promptOf(it), options: labelsOf(it) });
    }
    const ids = feedback.map((f) => f.thesisId);
    const th = ids.length ? await q("select id,asset,direction from theses where id = any($1::uuid[])", [ids]) : [];
    for (const f of feedback) { const t = th.find((x) => x.id === f.thesisId); if (t) f.asset = `${t.asset} ${t.direction}`; }
    return {
      omnaraError: open.error ?? null,
      approvals: rows.map((r) => ({ ...r, entry: num(r.entry), size: num(r.size), stop: num(r.stop), target: num(r.target), confidence: num(r.confidence), questionOpen: approvalIds.has(r.thesis_id) })),
      feedback,
    };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    const kind = b.kind === "feedback" ? "feedback" : b.kind === "approval" ? "approval" : null;
    if (!kind) throw new HttpError(400, "kind must be approval or feedback");
    if (typeof b.thesisId !== "string" || !UUID.test(b.thesisId)) throw new HttpError(400, "invalid thesisId");
    const choice = String(b.choice ?? "");
    if (kind === "approval" && !["approve", "reject"].includes(choice)) throw new HttpError(400, "choice must be approve or reject");
    if (kind === "feedback" && !(FEEDBACK_LABELS as readonly string[]).includes(choice)) throw new HttpError(400, "invalid feedback choice");
    if (kind === "approval") {
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
