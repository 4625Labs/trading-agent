import type { Thesis, TradeResult } from "@trading-agent/shared";
import type { Db } from "./db.ts";
import type { SimPosition, Simulator } from "./simulator.ts";

export type PriceFn = (asset: string) => Promise<number>;
export interface RealCloser {
  closePosition(thesisId: string, asset: string, qty: number): Promise<TradeResult>;
}
export interface WatcherOpts {
  log?: (s: string) => void;
  maxRealCloseFailures?: number;
  /** Test isolation: when set, only these thesis ids are ever touched. Never set in production. */
  scope?: Set<string>;
}
export interface ClosedInfo {
  thesisId: string;
  asset: string;
  reason: string;
  pnl: number;
}

interface OpenRow {
  id: string; asset: string; direction: "long" | "short"; entry: string; size: string; stop: string; target: string;
  rationale: string | null; confidence: number; signal_ids: string[] | null; fill_price: string; qty: string; fee: string;
}

/** Rebuild an in-memory simulator position from persisted thesis + synthetic trade rows. */
export function positionFromRow(r: OpenRow): SimPosition {
  const thesis: Thesis = { id: r.id, asset: r.asset, direction: r.direction, entry: +r.entry, size: +r.size, stop: +r.stop, target: +r.target, rationale: r.rationale ?? "", confidence: r.confidence, signalIds: r.signal_ids ?? [] };
  return { thesis, fillPrice: +r.fill_price, qty: +r.qty, entryFee: +r.fee, status: "open" };
}

/** Net pnl of a spot round trip: price move on the sold qty minus entry and exit fees. */
export function realPnl(buy: { fillPrice: number; fee: number }, sell: { fillPrice: number; qty: number; fee: number }): number {
  return (sell.fillPrice - buy.fillPrice) * sell.qty - buy.fee - sell.fee;
}

/**
 * Closes executed theses at stop/target. Synthetic positions via Simulator.markToMarket, real testnet position via a market sell.
 * Crash-safe: state lives in the DB (synthetic_trades.closed_at / real_trades.closed_at), the simulator is rebuilt from it each tick,
 * and the real sell is claimed in the DB before being sent so a restart can never sell twice.
 */
export class Watcher {
  db: Db;
  getPrice: PriceFn;
  sim: Simulator;
  real?: RealCloser;
  opts: WatcherOpts;
  private failures = new Map<string, number>();

  constructor(db: Db, getPrice: PriceFn, sim: Simulator, real?: RealCloser, opts: WatcherOpts = {}) {
    this.db = db;
    this.getPrice = getPrice;
    this.sim = sim;
    this.real = real;
    this.opts = opts;
  }
  private log(s: string) {
    (this.opts.log ?? console.log)(`[watcher ${new Date().toISOString().slice(11, 19)}] ${s}`);
  }

  /** Make the simulator match the DB: add missing open positions, reopen ones whose close never persisted. */
  async rehydrate(): Promise<OpenRow[]> {
    const rows: OpenRow[] = (await this.db.pool.query(
      `select t.id,t.asset,t.direction,t.entry,t.size,t.stop,t.target,t.rationale,t.confidence,t.signal_ids,st.fill_price,st.qty,st.fee
         from theses t join synthetic_trades st on st.thesis_id=t.id
        where t.status='executed' and st.closed_at is null`,
    )).rows;
    const scope = this.opts.scope;
    if (scope) rows.splice(0, rows.length, ...rows.filter((r) => scope.has(r.id)));
    for (const r of rows) {
      const have = this.sim.positions.get(r.id);
      if (!have || have.status === "closed") this.sim.positions.set(r.id, positionFromRow(r));
    }
    return rows;
  }

  async tick(): Promise<ClosedInfo[]> {
    const open = await this.rehydrate();
    const closedNow: ClosedInfo[] = [];

    // Phase 1: synthetic stop/target detection and persistence.
    const prices: Record<string, number> = {};
    for (const asset of new Set(open.map((r) => r.asset))) {
      try { prices[asset] = await this.getPrice(asset); } catch (e) { this.log(`price ${asset} failed: ${(e as Error).message}`); }
    }
    const watched = new Set(open.map((r) => r.id));
    for (const p of this.sim.markToMarket(prices)) {
      if (!watched.has(p.thesis.id)) continue;
      try {
        await this.db.pool.query(
          "update synthetic_trades set closed_at=now(), pnl=$2, exit_price=$3, exit_reason=$4 where thesis_id=$1 and closed_at is null",
          [p.thesis.id, p.pnl, p.exitPrice, p.exitReason],
        );
        this.log(`synthetic ${p.thesis.asset} closed at ${p.exitReason}: pnl ${p.pnl!.toFixed(2)}`);
      } catch (e) {
        // persistence failed: put the position back so the next tick retries
        p.status = "open"; delete p.exitPrice; delete p.exitReason; delete p.pnl;
        this.log(`persist close failed for ${p.thesis.id}: ${(e as Error).message}`);
      }
    }

    // Phase 2: finalize theses whose synthetic leg is closed: real sell, then mark the thesis closed.
    const ready = (await this.db.pool.query(
      `select t.id,t.asset from theses t
        where t.status='executed'
          and exists (select 1 from synthetic_trades s where s.thesis_id=t.id and s.closed_at is not null)
          and not exists (select 1 from synthetic_trades s where s.thesis_id=t.id and s.closed_at is null)`,
    )).rows as { id: string; asset: string }[];
    for (const t of ready) {
      if (this.opts.scope && !this.opts.scope.has(t.id)) continue;
      try {
        const info = await this.finalize(t.id, t.asset);
        if (info) closedNow.push(info);
      } catch (e) {
        this.log(`finalize ${t.id} failed: ${(e as Error).message}`);
      }
    }
    return closedNow;
  }

  private async finalize(thesisId: string, asset: string): Promise<ClosedInfo | null> {
    const max = this.opts.maxRealCloseFailures ?? 5;
    if (this.real) {
      const legs = (await this.db.pool.query("select id,fill_price,qty,fee from real_trades where thesis_id=$1 and closed_at is null and pnl is null", [thesisId])).rows;
      for (const leg of legs) {
        if ((this.failures.get(leg.id) ?? 0) >= max) continue; // given up; flagged below
        const claim = await this.db.pool.query("update real_trades set closed_at=now() where id=$1 and closed_at is null returning id", [leg.id]);
        if (!claim.rowCount) continue;
        try {
          const sell = await this.real.closePosition(thesisId, asset, +leg.qty);
          const pnl = realPnl({ fillPrice: +leg.fill_price, fee: +leg.fee }, sell);
          await this.db.pool.query("update real_trades set pnl=$2, exit_price=$3 where id=$1", [leg.id, pnl, sell.fillPrice]);
          this.log(`real ${asset} sold @${sell.fillPrice.toFixed(2)}: pnl ${pnl.toFixed(2)}`);
        } catch (e) {
          await this.db.pool.query("update real_trades set closed_at=null where id=$1", [leg.id]); // release claim only if no sell happened
          const n = (this.failures.get(leg.id) ?? 0) + 1;
          this.failures.set(leg.id, n);
          this.log(`real close failed (${n}/${max}) for ${thesisId}: ${(e as Error).message}`);
          if (n < max) return null; // retry next tick
        }
      }
    }
    const s = (await this.db.pool.query(
      "select coalesce(sum(pnl),0) pnl, (array_agg(exit_reason order by closed_at desc))[1] reason, (array_agg(exit_price order by closed_at desc))[1] px from synthetic_trades where thesis_id=$1",
      [thesisId],
    )).rows[0];
    const r = await this.db.pool.query(
      "update theses set status='closed', closed_at=now(), exit_reason=$2, exit_price=$3, pnl=$4 where id=$1 and status='executed'",
      [thesisId, s.reason, s.px, s.pnl],
    );
    if (!r.rowCount) return null;
    this.log(`thesis ${thesisId} closed (${s.reason}) pnl ${(+s.pnl).toFixed(2)}`);
    return { thesisId, asset, reason: s.reason, pnl: +s.pnl };
  }

  async run(intervalMs = 15_000, stop: () => boolean = () => false) {
    while (!stop()) {
      try { await this.tick(); } catch (e) { this.log(`tick error: ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
