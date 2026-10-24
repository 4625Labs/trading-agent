import pg from "pg";
import type { GuardrailDecision, GuardrailState, Preferences, Thesis, TradeResult } from "@trading-agent/shared";

export const DEFAULT_PREFS: Preferences = {
  allowedAssets: ["BTC", "ETH", "SOL"],
  bannedAssets: [],
  maxPositionPct: 0.05,
  approvalThresholdUsd: 25,
  minConfidence: 0.5,
};

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** Thin Postgres repository over the Supabase schema. Uses DATABASE_URL; never logs it. */
export class Db {
  pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 4 });
  }
  static fromEnv(env: Record<string, string | undefined> = process.env) {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    return new Db(env.DATABASE_URL);
  }
  close() {
    return this.pool.end();
  }

  async prefs(userId = "default"): Promise<Preferences & { killSwitch?: boolean }> {
    const r = await this.pool.query("select data from preferences where user_id=$1 order by updated_at desc limit 1", [userId]);
    if (r.rows[0]) return { ...DEFAULT_PREFS, ...r.rows[0].data };
    await this.pool.query("insert into preferences(user_id,data) values ($1,$2)", [userId, DEFAULT_PREFS]);
    return DEFAULT_PREFS;
  }
  async setKillSwitch(on: boolean, userId = "default") {
    const p = await this.prefs(userId);
    await this.pool.query("update preferences set data=$2, updated_at=now() where user_id=$1", [userId, { ...p, killSwitch: on }]);
  }

  async insertThesis(t: Omit<Thesis, "id">, status: string): Promise<string> {
    const r = await this.pool.query(
      `insert into theses(asset,direction,entry,size,stop,target,rationale,confidence,signal_ids,status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [t.asset, t.direction, t.entry, t.size, t.stop, t.target, t.rationale, t.confidence, t.signalIds, status],
    );
    return r.rows[0].id;
  }
  async getThesis(id: string): Promise<(Thesis & { status: string }) | null> {
    const r = await this.pool.query("select * from theses where id=$1", [id]);
    const x = r.rows[0];
    if (!x) return null;
    return { id: x.id, asset: x.asset, direction: x.direction, entry: +x.entry, size: +x.size, stop: +x.stop, target: +x.target, rationale: x.rationale ?? "", confidence: x.confidence, signalIds: x.signal_ids ?? [], status: x.status };
  }
  setThesisStatus(id: string, status: string) {
    return this.pool.query("update theses set status=$2 where id=$1", [id, status]);
  }

  async ensureApproval(thesisId: string): Promise<{ id: string; status: ApprovalStatus }> {
    const r = await this.pool.query("select id,status from approvals where thesis_id=$1 order by created_at desc limit 1", [thesisId]);
    if (r.rows[0]) return r.rows[0];
    const n = await this.pool.query("insert into approvals(thesis_id) values ($1) returning id,status", [thesisId]);
    return n.rows[0];
  }
  async decideApproval(thesisId: string, status: "approved" | "rejected", feedback?: string) {
    await this.pool.query("update approvals set status=$2, feedback=$3, decided_at=now() where thesis_id=$1 and status='pending'", [thesisId, status, feedback ?? null]);
  }
  async approvalStatus(thesisId: string): Promise<ApprovalStatus | null> {
    const r = await this.pool.query("select status from approvals where thesis_id=$1 order by created_at desc limit 1", [thesisId]);
    return r.rows[0]?.status ?? null;
  }
  async pendingApprovals(): Promise<string[]> {
    return (await this.pool.query("select thesis_id from approvals where status='pending'")).rows.map((r) => r.thesis_id);
  }

  logGuardrail(thesisId: string | null, d: GuardrailDecision) {
    return this.pool.query("insert into guardrail_events(thesis_id,verdict,reasons) values ($1,$2,$3)", [thesisId, d.verdict, d.reasons]);
  }
  recordSynthetic(r: TradeResult) {
    return this.pool.query("insert into synthetic_trades(thesis_id,fill_price,qty,fee) values ($1,$2,$3,$4)", [r.thesisId, r.fillPrice, r.qty, r.fee]);
  }
  recordReal(r: TradeResult) {
    return this.pool.query("insert into real_trades(thesis_id,venue,fill_price,qty,fee) values ($1,$2,$3,$4,$5)", [r.thesisId, r.venue, r.fillPrice, r.qty, r.fee]);
  }
  async guardrailState(walletUsd: number, killSwitch: boolean): Promise<GuardrailState> {
    const [exp, pnl, rate] = await Promise.all([
      this.pool.query("select coalesce(sum(size),0) s from theses where status in ('open','executed')"),
      this.pool.query("select coalesce(sum(pnl),0) s from real_trades where created_at > now() - interval '1 day'"),
      this.pool.query("select count(*)::int c from real_trades where created_at > now() - interval '1 hour'"),
    ]);
    return { walletUsd, openExposureUsd: +exp.rows[0].s, dailyPnlUsd: +pnl.rows[0].s, ordersLastHour: rate.rows[0].c, killSwitch };
  }
  insertLesson(text: string, origin: string) {
    return this.pool.query("insert into lessons(text,origin) values ($1,$2)", [text, origin]);
  }
}
