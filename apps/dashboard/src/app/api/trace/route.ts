import { q, tryq } from "@/lib/db";
import { HttpError, UUID, handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const thesisId = new URL(req.url).searchParams.get("thesis");
    if (thesisId && !UUID.test(thesisId)) throw new HttpError(400, "invalid thesis id");
    if (!thesisId) {
      const ev = await tryq("select id,ts,kind,title,detail,thesis_id,agent_id from agent_events order by ts desc limit 200");
      return { events: ev.rows };
    }
    const th = (await q("select * from theses where id=$1", [thesisId]))[0];
    if (!th) throw new HttpError(404, "thesis not found");
    const sigIds: string[] = th.signal_ids ?? [];
    const [signals, direct, proposed, trades, approvals] = await Promise.all([
      sigIds.length ? q(`select s.id,s.asset,s.direction,s.magnitude,s.horizon,s.confidence,s.url,s.created_at,so.url source from signals s left join sources so on so.id=s.source_id where s.id = any($1::uuid[]) order by s.created_at`, [sigIds]) : Promise.resolve([]),
      tryq("select id,ts,kind,title,detail,thesis_id,agent_id from agent_events where thesis_id=$1 order by ts asc", [thesisId]),
      // thesis_proposed events have no thesis_id: link by signal overlap, else same asset+direction just before the thesis
      tryq(`select id,ts,kind,title,detail,thesis_id,agent_id from agent_events where kind='thesis_proposed' and thesis_id is null and (
              (detail->'signalIds' ?| $1::text[]) or (upper(detail->>'asset')=upper($2) and lower(detail->>'direction')=lower($3) and ts <= $4::timestamptz + interval '1 minute' and ts > $4::timestamptz - interval '1 day'))
            order by (detail->'signalIds' ?| $1::text[]) desc, ts desc limit 1`, [sigIds, th.asset, th.direction, th.created_at]),
      q(`select 'practice' venue, fill_price,qty,fee,pnl,created_at from synthetic_trades where thesis_id=$1 union all select 'real', fill_price,qty,fee,pnl,created_at from real_trades where thesis_id=$1 order by created_at`, [thesisId]),
      q("select status,feedback,created_at,decided_at from approvals where thesis_id=$1 order by created_at", [thesisId]),
    ]);
    const first = signals[0]?.created_at ?? th.created_at;
    const ingest = await tryq("select id,ts,kind,title,detail from agent_events where kind='ingest' and ts <= $1::timestamptz + interval '1 minute' order by ts desc limit 1", [first]);
    const events = [...proposed.rows, ...direct.rows].sort((a: any, b: any) => +new Date(a.ts) - +new Date(b.ts));
    return {
      thesis: { ...th, entry: num(th.entry), size: num(th.size), stop: num(th.stop), target: num(th.target) },
      signals: signals.map((s: any) => ({ ...s, magnitude: num(s.magnitude), confidence: num(s.confidence) })),
      trades: trades.map((t: any) => ({ ...t, fill_price: num(t.fill_price), qty: num(t.qty), fee: num(t.fee), pnl: num(t.pnl) })),
      approvals, events, ingest: ingest.rows[0] ?? null,
    };
  });
}
