import { q, tryq } from "@/lib/db";
import { handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function GET() {
  return handle(async () => {
    const [rows, ex, cal] = await Promise.all([
      tryq(`select t.id,t.asset,t.closed_at,
              s.fill_price sf,s.fee sfee,s.qty sq,s.pnl spnl, r.fill_price rf,r.fee rfee,r.qty rq,r.pnl rpnl
            from theses t
            join lateral (select * from synthetic_trades where thesis_id=t.id order by created_at limit 1) s on true
            join lateral (select * from real_trades where thesis_id=t.id order by created_at limit 1) r on true
            where t.status='closed' and t.demo=false and t.direction='long' order by t.closed_at desc nulls last limit 200`),
      q(`select
          (count(*) filter (where status='closed' and direction='short'))::int shorts,
          (count(*) filter (where status='closed' and demo=true))::int demo,
          (count(*) filter (where status='closed' and demo=false and direction='long' and not exists (select 1 from real_trades r where r.thesis_id=theses.id)))::int no_real,
          (count(*) filter (where status='closed'))::int closed from theses`).catch(() => [{ shorts: 0, demo: 0, no_real: 0, closed: 0 }]),
      tryq("select ts,slippage_bps,fee_bps,n_trades,detail from sim_calibration order by ts desc limit 1"),
    ]);
    const trades = rows.rows.map((r: any) => {
      const sf = num(r.sf), rf = num(r.rf), sfee = num(r.sfee), rfee = num(r.rfee), sp = num(r.spnl), rp = num(r.rpnl);
      return {
        id: r.id, asset: r.asset, closed_at: r.closed_at, simFill: sf, realFill: rf,
        slippageBps: sf && rf !== null ? ((rf! - sf) / sf) * 1e4 : null,
        feeGap: sfee !== null && rfee !== null ? rfee! - sfee : null,
        simPnl: sp, realPnl: rp, pnlGap: sp !== null && rp !== null ? rp! - sp : null,
      };
    });
    const sum = (k: "simPnl" | "realPnl") => trades.reduce((a: number, t: any) => a + (t[k] ?? 0), 0);
    return {
      trades,
      summary: {
        n: trades.length,
        avgSlippageBps: avg(trades.map((t: any) => t.slippageBps).filter((x: any) => x !== null)),
        avgFeeGap: avg(trades.map((t: any) => t.feeGap).filter((x: any) => x !== null)),
        simPnl: sum("simPnl"), realPnl: sum("realPnl"),
      },
      excluded: { shorts: ex[0].shorts, demo: ex[0].demo, noRealLeg: ex[0].no_real, closed: ex[0].closed },
      calibration: cal.rows[0] ? { ...cal.rows[0], slippage_bps: num(cal.rows[0].slippage_bps), fee_bps: num(cal.rows[0].fee_bps) } : null,
    };
  });
}
