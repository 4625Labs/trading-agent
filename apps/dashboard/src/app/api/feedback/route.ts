import { q } from "@/lib/db";
import { HttpError, body, handle, num } from "@/lib/http";
import { validateFeedback } from "@/lib/feedback";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const rows = await q(`select t.id,t.asset,t.direction,t.exit_reason,t.pnl,t.rationale,t.closed_at,
        exists(select 1 from commands c where c.kind='feedback' and c.status='pending' and c.payload->>'thesisId'=t.id::text) sent
      from theses t where t.status='closed' and t.feedback is null order by t.closed_at desc nulls last, t.created_at desc limit 50`);
    return { items: rows.map((r) => ({ ...r, pnl: num(r.pnl), rationale: String(r.rationale ?? "").slice(0, 220) })) };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const v = validateFeedback(await body(req));
    if (typeof v === "string") throw new HttpError(400, v);
    const t = (await q("select status,feedback from theses where id=$1", [v.thesisId]))[0];
    if (!t) throw new HttpError(404, "thesis not found");
    if (t.status !== "closed") throw new HttpError(409, "thesis is not closed yet");
    if (t.feedback) throw new HttpError(409, "feedback already given for this thesis");
    const dup = await q("select 1 from commands where kind='feedback' and status='pending' and payload->>'thesisId'=$1 limit 1", [v.thesisId]);
    if (dup.length) throw new HttpError(429, "feedback for this thesis is already being processed");
    const r = await q("insert into commands(kind,payload) values ('feedback',$1::jsonb) returning id,kind,payload,status,created_at", [JSON.stringify(v)]);
    return { command: r[0] };
  });
}
