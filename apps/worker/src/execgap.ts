/** Execution gap: how far real (testnet) fills differ from the simulator's, and a calibration step that feeds it back. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface GapTrade {
  thesisId: string;
  asset: string;
  simFill: number;
  realFill: number;
  /** (realFill - simFill) / simFill * 1e4 for longs; positive = real filled worse (higher) than sim */
  slippageGapBps: number;
  simFee: number;
  realFee: number;
  /** real fee bps of notional minus sim fee bps of notional; positive = real pays more */
  feeGapBps: number;
  simExit: number | null;
  realExit: number | null;
  simPnl: number;
  realPnl: number;
  /** simPnl - realPnl; positive = real did worse than sim */
  pnlGap: number;
}
export interface GapSummary {
  n: number;
  avgSlippageGapBps: number;
  avgFeeGapBps: number;
  avgPnlGap: number;
  simTotalPnl: number;
  realTotalPnl: number;
  excludedDemo: number;
  excludedShortsNoRealLeg: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const nz = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Closed, non-demo LONG theses with both a synthetic and a real leg. `opts.thesisIds` restricts the set (tests). */
export async function computeExecutionGap(pool: Queryable, opts: { thesisIds?: string[] } = {}): Promise<{ trades: GapTrade[]; summary: GapSummary }> {
  const filter = opts.thesisIds ? "and t.id = any($1::uuid[])" : "";
  const params = opts.thesisIds ? [opts.thesisIds] : [];
  const r = await pool.query(
    `select t.id, t.asset,
            s.fill_price s_fill, s.qty s_qty, s.fee s_fee, s.exit_price s_exit, s.pnl s_pnl,
            rl.fill_price r_fill, rl.qty r_qty, rl.fee r_fee, rl.exit_price r_exit, rl.pnl r_pnl
     from theses t
     join lateral (select * from synthetic_trades where thesis_id=t.id order by created_at limit 1) s on true
     join lateral (select * from real_trades where thesis_id=t.id order by created_at limit 1) rl on true
     where t.status='closed' and t.demo=false and t.direction='long' ${filter}
     order by t.closed_at`,
    params,
  );
  const trades: GapTrade[] = r.rows.map((x) => {
    const simFill = +x.s_fill, realFill = +x.r_fill, simFee = +x.s_fee, realFee = +x.r_fee;
    const simNot = simFill * +x.s_qty, realNot = realFill * +x.r_qty;
    const simPnl = +(x.s_pnl ?? 0), realPnl = +(x.r_pnl ?? 0);
    return {
      thesisId: x.id, asset: x.asset, simFill, realFill,
      slippageGapBps: simFill ? ((realFill - simFill) / simFill) * 1e4 : 0,
      simFee, realFee,
      feeGapBps: (realNot ? (realFee / realNot) * 1e4 : 0) - (simNot ? (simFee / simNot) * 1e4 : 0),
      simExit: nz(x.s_exit), realExit: nz(x.r_exit), simPnl, realPnl, pnlGap: simPnl - realPnl,
    };
  });
  const cnt = async (sql: string) => +(await pool.query(sql, params)).rows[0].c;
  const excludedDemo = await cnt(`select count(*)::int c from theses t where t.status='closed' and t.demo=true and t.direction='long' ${filter}`);
  const excludedShortsNoRealLeg = await cnt(
    `select count(*)::int c from theses t where t.status='closed' and t.demo=false ${filter}
       and (t.direction='short' or not exists (select 1 from real_trades where thesis_id=t.id))`,
  );
  return {
    trades,
    summary: {
      n: trades.length,
      avgSlippageGapBps: avg(trades.map((t) => t.slippageGapBps)),
      avgFeeGapBps: avg(trades.map((t) => t.feeGapBps)),
      avgPnlGap: avg(trades.map((t) => t.pnlGap)),
      simTotalPnl: trades.reduce((a, t) => a + t.simPnl, 0),
      realTotalPnl: trades.reduce((a, t) => a + t.realPnl, 0),
      excludedDemo, excludedShortsNoRealLeg,
    },
  };
}

export interface CalibrationConfig { slippageBps: number; feeBps: number }
const clampBps = (v: number) => Math.min(50, Math.max(0, v));
export const EMA_ALPHA = 0.3;
export const MIN_CALIBRATION_TRADES = 3;

/**
 * Pure step. The gaps are measured against sim fills that already include `current` costs, so the implied real cost is
 * current + gap; the new value is an EMA (alpha 0.3) from current toward that, clamped to 0..50 bps.
 */
export function nextCalibration(current: CalibrationConfig, s: Pick<GapSummary, "n" | "avgSlippageGapBps" | "avgFeeGapBps">): CalibrationConfig & { calibrated: boolean } {
  if (s.n < MIN_CALIBRATION_TRADES) return { ...current, calibrated: false };
  const ema = (cur: number, gap: number) => clampBps(cur * (1 - EMA_ALPHA) + clampBps(cur + gap) * EMA_ALPHA);
  return { slippageBps: ema(current.slippageBps, s.avgSlippageGapBps), feeBps: ema(current.feeBps, s.avgFeeGapBps), calibrated: true };
}

/** Compute the gap, and when n>=3 persist a sim_calibration row and return the new config; otherwise return current unchanged. */
export async function recalibrateSim(pool: Queryable, current: CalibrationConfig, opts: { thesisIds?: string[] } = {}) {
  const { summary } = await computeExecutionGap(pool, opts);
  const next = nextCalibration(current, summary);
  if (next.calibrated) {
    await pool.query("insert into sim_calibration(slippage_bps,fee_bps,n_trades,detail) values ($1,$2,$3,$4)", [
      next.slippageBps, next.feeBps, summary.n, JSON.stringify({ previous: current, summary, alpha: EMA_ALPHA }),
    ]);
  }
  return { slippageBps: next.slippageBps, feeBps: next.feeBps, calibrated: next.calibrated, n: summary.n, summary };
}

export async function loadLatestCalibration(pool: Queryable): Promise<(CalibrationConfig & { ts: string; nTrades: number }) | null> {
  const r = await pool.query("select slippage_bps, fee_bps, n_trades, ts from sim_calibration order by ts desc limit 1");
  const x = r.rows[0];
  return x ? { slippageBps: +x.slippage_bps, feeBps: +x.fee_bps, nTrades: x.n_trades, ts: String(x.ts) } : null;
}
