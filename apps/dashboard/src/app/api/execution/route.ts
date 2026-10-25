import { q, tryq } from "@/lib/db";
import { handle, num } from "@/lib/http";
export const dynamic = "force-dynamic";
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const LEGS = `join lateral (select * from synthetic_trades where thesis_id=t.id order by created_at limit 1) s on true
              join lateral (select * from real_trades where thesis_id=t.id order by created_at limit 1) r on true`;

export function GET() {
  return handle(async () => {
    const [entries, exits, counts, cal] = await Promise.all([
      tryq(`select t.id,t.asset,t.direction,t.status,t.demo,t.size,s.created_at ts,s.fill_price sf,s.fee sfee,r.fill_price rf,r.fee rfee
            from theses t ${LEGS} order by s.created_at desc limit 200`),
      tryq(`select t.id,t.asset,t.closed_at,s.fill_price sf,s.fee sfee,s.pnl spnl,s.exit_price sx,r.fill_price rf,r.fee rfee,r.pnl rpnl
            from theses t ${LEGS} where t.status='closed' and t.demo=false and t.direction='long' order by t.closed_at desc nulls last limit 200`),
      q(`select
          (select count(distinct thesis_id) from synthetic_trades)::int practice,
          (select count(distinct thesis_id) from real_trades)::int real,
          (select count(*) from theses t where t.direction='short' and exists (select 1 from synthetic_trades s where s.thesis_id=t.id))::int shorts,
          (select count(*) from theses t where t.direction='long' and exists (select 1 from synthetic_trades s where s.thesis_id=t.id) and not exists (select 1 from real_trades r where r.thesis_id=t.id))::int longs_waiting,
          (select count(*) from theses where status='closed' and demo=true)::int demo_exits,
          (select count(*) from theses where status='closed' and direction='short')::int closed_shorts`).catch(() => [{ practice: 0, real: 0, shorts: 0, longs_waiting: 0, demo_exits: 0, closed_shorts: 0 }]),
      tryq("select ts,slippage_bps,fee_bps,n_trades,detail from sim_calibration order by ts desc limit 1"),
    ]);
    const entryRows = entries.rows.map((r: any) => {
      const sf = num(r.sf), rf = num(r.rf), sfee = num(r.sfee), rfee = num(r.rfee);
      return { id: r.id, asset: r.asset, direction: r.direction, status: r.status, demo: r.demo, size: num(r.size), ts: r.ts, simFill: sf, realFill: rf,
        slippageBps: sf && rf !== null ? ((rf! - sf) / sf) * 1e4 : null, feeGap: sfee !== null && rfee !== null ? rfee! - sfee : null };
    });
    const exitRows = exits.rows.map((r: any) => {
      const sp = num(r.spnl), rp = num(r.rpnl);
      return { id: r.id, asset: r.asset, closed_at: r.closed_at, simExit: num(r.sx), simPnl: sp, realPnl: rp, pnlGap: sp !== null && rp !== null ? rp! - sp : null };
    });
    const pg = exitRows.filter((t: any) => t.pnlGap !== null);
    const c = counts[0];
    return {
      entries: entryRows, exits: exitRows,
      summary: {
        entryN: entryRows.length,
        avgSlippageBps: avg(entryRows.map((t: any) => t.slippageBps).filter((x: any) => x !== null)),
        avgFeeGap: avg(entryRows.map((t: any) => t.feeGap).filter((x: any) => x !== null)),
        exitN: pg.length,
        simPnl: pg.reduce((a: number, t: any) => a + t.simPnl, 0), realPnl: pg.reduce((a: number, t: any) => a + t.realPnl, 0),
      },
      counts: { practice: c.practice, real: c.real, shorts: c.shorts, longsWaiting: c.longs_waiting, demoExits: c.demo_exits, closedShorts: c.closed_shorts },
      calibration: cal.rows[0] ? { ...cal.rows[0], slippage_bps: num(cal.rows[0].slippage_bps), fee_bps: num(cal.rows[0].fee_bps) } : null,
    };
  });
}
