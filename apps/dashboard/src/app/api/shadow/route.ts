import { tryq } from "@/lib/db";
import { handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";
const POLICIES = ["learned", "equal"];

export function GET() {
  return handle(async () => {
    const [agg, closed, weights, recent] = await Promise.all([
      tryq(`select policy,
              (count(*) filter (where status='closed'))::int closed,
              (count(*) filter (where status='closed' and pnl > 0))::int wins,
              (count(*) filter (where status='open'))::int open,
              coalesce(sum(pnl) filter (where status='closed'),0) pnl,
              coalesce(avg(size),0) avg_size from shadow_trades group by policy`),
      tryq("select policy,closed_at,pnl from shadow_trades where status='closed' and closed_at is not null order by closed_at asc limit 2000"),
      tryq("select source,weight,hits,trials,updated_at from shadow_weights order by weight desc limit 100"),
      tryq("select id,policy,asset,direction,entry,exit_price,pnl,exit_reason,status,opened_at,closed_at from shadow_trades order by coalesce(closed_at,opened_at) desc limit 30"),
    ]);
    const policies: Record<string, any> = {};
    for (const p of POLICIES) {
      const a = agg.rows.find((r: any) => r.policy === p);
      let cum = 0;
      policies[p] = {
        closed: a?.closed ?? 0, wins: a?.wins ?? 0, open: a?.open ?? 0, pnl: Number(a?.pnl ?? 0), avgSize: Number(a?.avg_size ?? 0),
        hitRate: a?.closed ? a.wins / a.closed : null,
        series: closed.rows.filter((r: any) => r.policy === p).map((r: any) => ({ t: new Date(r.closed_at).getTime(), v: (cum += Number(r.pnl ?? 0)) })),
      };
    }
    return {
      policies,
      minClosed: Math.min(...POLICIES.map((p) => policies[p].closed)),
      weights: weights.rows.map((w: any) => ({ ...w, weight: num(w.weight) })),
      recent: recent.rows.map((r: any) => ({ ...r, entry: num(r.entry), exit_price: num(r.exit_price), pnl: num(r.pnl) })),
    };
  });
}
