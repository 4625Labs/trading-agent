import type { Preferences } from "@trading-agent/shared";
import type { Db } from "./db.ts";
import type { Omnara } from "./omnara.ts";
import type { LlmFn } from "./ingest/llm.ts";
import { runIngest } from "./ingest/index.ts";
import type { IngestResult } from "./ingest/index.ts";
import { generateTheses, proposeToAgent } from "./thesis/index.ts";
import type { ProposedThesis, SignalRow } from "./thesis/index.ts";
import { emit } from "./trace.ts";

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface AgentConfig {
  enabled: boolean;
  intervalSeconds: number;
  assets: string[];
  confidenceBar: number;
  maxTradesPerCycle: number;
  tradeSizeUsd: number;
  realOrders: boolean;
}
export const DEFAULT_CONFIG: AgentConfig = {
  enabled: true, intervalSeconds: 1800, assets: ["BTC", "ETH", "SOL"], confidenceBar: 0.5, maxTradesPerCycle: 1, tradeSizeUsd: 50, realOrders: true,
};
const ALL_ASSETS = ["BTC", "ETH", "SOL"];

const clampNum = (v: unknown, lo: number, hi: number, dflt: number, int = false) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return dflt;
  const c = Math.min(hi, Math.max(lo, n));
  return int ? Math.round(c) : c;
};
const asBool = (v: unknown, dflt: boolean) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : dflt);

/** Validate and clamp a (possibly partial / garbage) config; missing or invalid keys fall back to `base`. */
export function normalizeConfig(raw: unknown, base: AgentConfig = DEFAULT_CONFIG): AgentConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let assets = base.assets;
  if (Array.isArray(r.assets)) {
    const a = [...new Set(r.assets.map((x) => String(x).toUpperCase()).filter((x) => ALL_ASSETS.includes(x)))];
    if (a.length) assets = a;
  }
  return {
    enabled: asBool(r.enabled, base.enabled),
    intervalSeconds: clampNum(r.intervalSeconds, 60, 86400, base.intervalSeconds, true),
    assets,
    confidenceBar: clampNum(r.confidenceBar, 0.2, 0.95, base.confidenceBar),
    maxTradesPerCycle: clampNum(r.maxTradesPerCycle, 1, 5, base.maxTradesPerCycle, true),
    tradeSizeUsd: clampNum(r.tradeSizeUsd, 5, 500, base.tradeSizeUsd),
    realOrders: asBool(r.realOrders, base.realOrders),
  };
}

/** Reads agent_config 'default'; creates it with defaults if missing; always returns a validated config. */
export async function loadConfig(db: { pool: Queryable }): Promise<AgentConfig> {
  const r = await db.pool.query("select data from agent_config where id='default'");
  if (!r.rows[0]) {
    await db.pool.query("insert into agent_config(id,data) values ('default',$1) on conflict (id) do nothing", [JSON.stringify(DEFAULT_CONFIG)]);
    return { ...DEFAULT_CONFIG };
  }
  return normalizeConfig(r.rows[0].data);
}

/** Merge a patch into the stored config with the same validation. Returns the saved config. */
export async function saveConfig(db: { pool: Queryable }, patch: Record<string, unknown>): Promise<AgentConfig> {
  const cur = await loadConfig(db);
  const next = normalizeConfig(patch, cur);
  await db.pool.query(
    "insert into agent_config(id,data,updated_at) values ('default',$1,now()) on conflict (id) do update set data=$1, updated_at=now()",
    [JSON.stringify(next)],
  );
  return next;
}

export interface CycleDeps {
  db: { pool: Queryable };
  omnara: Pick<Omnara, "send">;
  /** optional: the agent's activity state; when it is waiting on an open question we do not queue more proposals */
  agentState?: (agent: string) => Promise<string | undefined>;
  /** active agent ids; the first one receives proposals */
  agents: () => string[];
  llm: LlmFn;
  price: (asset: string) => Promise<number>;
  walletUsd: number | (() => Promise<number>);
  /** thesis readers (pgThesisReaders(db) in production) */
  readers: { prefs: () => Promise<Preferences>; readSignals: () => Promise<SignalRow[]>; lessons: () => Promise<string[]> };
  /** one ingest pass; defaults to nothing in tests, production passes () => runIngest(defaultIngestDeps(db, log)) */
  ingest: () => Promise<IngestResult>;
  log?: (m: string) => void;
  /** override for tests; defaults to trace.emit */
  emit?: (kind: Parameters<typeof emit>[1], title: string, detail: Record<string, unknown>, thesisId: string | null, agentId?: string) => Promise<unknown>;
  now?: () => Date;
}
export interface CycleResult {
  cycleId: string;
  newSignals: number;
  signalsConsidered: number;
  ideas: number;
  proposed: ProposedThesis[];
  notes: string;
}

/**
 * One live cycle: ingest -> theses (bar/assets/size from cfg) -> propose up to maxTradesPerCycle to the agent,
 * writing a `cycles` ledger row. The row records the proposals in config.proposals so theses can be linked later.
 */
export async function runCycle(deps: CycleDeps, cfg: AgentConfig): Promise<CycleResult> {
  const log = deps.log ?? (() => {});
  const doEmit = deps.emit ?? ((k, t, d, th, a) => emit(deps.db as unknown as Db, k, t, d, th, a));
  const notes: string[] = [];
  const startedAt = (deps.now ?? (() => new Date()))();
  const ins = await deps.db.pool.query("insert into cycles(started_at,config) values ($1,$2) returning id", [startedAt, JSON.stringify(cfg)]);
  const cycleId: string = ins.rows[0].id;
  const agent = deps.agents()[0];

  let ing: IngestResult = { searches: 0, articles: 0, extracted: 0, inserted: 0, duplicates: 0, errors: 0 };
  let considered = 0, ideas = 0;
  const proposed: ProposedThesis[] = [];
  let sigRows: SignalRow[] = [];
  try {
    if (!agent) notes.push("no active agent; ingest only");
    ing = await deps.ingest();
    await doEmit("ingest", `Read ${ing.articles} news articles from ${ing.searches} searches, found ${ing.inserted} new signals (${ing.duplicates} already known)`, { ...ing }, null, agent);
    const prefs = await deps.readers.prefs();
    const wallet = typeof deps.walletUsd === "function" ? await deps.walletUsd() : deps.walletUsd;
    const allowed = prefs.allowedAssets.filter((a) => cfg.assets.includes(a));
    const theses = await generateTheses({
      llm: deps.llm, price: deps.price, walletUsd: wallet, log,
      lessons: deps.readers.lessons,
      readSignals: async () => { sigRows = (await deps.readers.readSignals()).filter((s) => allowed.includes(s.asset)); considered = sigRows.length; return sigRows; },
      prefs: async () => ({ ...prefs, allowedAssets: allowed, minConfidence: cfg.confidenceBar }),
    });
    ideas = theses.length;
    let blocked = false;
    if (agent && deps.agentState) {
      const st = await deps.agentState(agent).catch(() => undefined);
      if (st === "waiting_on_interaction") { blocked = true; notes.push("agent is waiting on an open question; not proposing more"); log("agent waiting on an open question; not queueing new proposals"); }
    }
    const cap = prefs.maxPositionPct * wallet;
    const ranked = [...theses].sort((a, b) => b.confidence - a.confidence);
    for (const t of ranked) {
      if (proposed.length >= cfg.maxTradesPerCycle) break;
      if (!agent || blocked) break;
      const dup = await deps.db.pool.query(
        "select 1 where exists (select 1 from theses where asset=$1 and direction=$2 and status in ('proposed','pending_approval','executed') and created_at > now() - interval '6 hours') or exists (select 1 from agent_events where kind='thesis_proposed' and detail->>'asset'=$1 and detail->>'direction'=$2 and ts > now() - interval '6 hours')",
        [t.asset, t.direction],
      );
      if (dup.rowCount) { log(`skip ${t.asset} ${t.direction}: similar thesis already active`); notes.push(`skipped ${t.asset} ${t.direction} (similar active)`); continue; }
      const sized: ProposedThesis = { ...t, size: Math.round(Math.min(cfg.tradeSizeUsd, cap) * 100) / 100 };
      if (!(sized.size > 0)) { notes.push("position cap is zero"); continue; }
      await doEmit("thesis_proposed", `Idea: ${sized.direction} ${sized.asset} $${sized.size}. Why: ${sized.rationale}`, { asset: sized.asset, direction: sized.direction, size: sized.size, entry: sized.entry, stop: sized.stop, target: sized.target, confidence: sized.confidence, rationale: sized.rationale, venueHint: sized.venueHint, signalIds: sized.signalIds, realOrders: cfg.realOrders }, null, agent);
      await proposeToAgent(deps.omnara, agent, sized);
      log(`proposed ${sized.asset} ${sized.direction} $${sized.size} to the agent`);
      proposed.push(sized);
    }
  } catch (e) {
    notes.push(`error: ${(e as Error).message.slice(0, 200)}`);
    log(`cycle error: ${(e as Error).message}`);
  }

  const w = await deps.db.pool.query("select id,url,weight from sources").catch(() => ({ rows: [] as any[] }));
  const weights = Object.fromEntries(w.rows.map((x) => [x.url ?? x.id, +x.weight]));
  const lc = await deps.db.pool.query("select count(*)::int c from lessons").catch(() => ({ rows: [{ c: 0 }] }));
  await deps.db.pool.query(
    `update cycles set finished_at=$2, config=$3, signals_considered=$4, new_signals=$5, ideas=$6, proposed=$7, weights=$8, lessons_count=$9, notes=$10 where id=$1`,
    [cycleId, (deps.now ?? (() => new Date()))(), JSON.stringify({ ...cfg, proposals: proposed.map((p) => ({ asset: p.asset, direction: p.direction, size: p.size })) }), considered, ing.inserted, ideas, proposed.length, JSON.stringify(weights), lc.rows[0].c, notes.join("; ") || null],
  );
  return { cycleId, newSignals: ing.inserted, signalsConsidered: considered, ideas, proposed, notes: notes.join("; ") };
}

export const LINK_WINDOW_HOURS = 2;

/**
 * Link theses to cycles and refresh outcomes. Idempotent and cheap (looks only at cycles from the last 7 days).
 * RULE: a thesis belongs to the cycle C when
 *   thesis.created_at is in [C.started_at, min(next cycle's started_at, C.started_at + 2h))   (theses appear when the agent
 *   calls place_order, shortly after the proposal), AND
 *   (thesis.asset, thesis.direction) is one of C.config.proposals, AND
 *   the thesis is not already linked to a different cycle.
 * (Signal overlap is not used: the agent's place_order call does not carry signal ids.)
 * Outcomes: closed = linked theses with status 'closed' and demo=false, wins = those with pnl>0, pnl = sum(pnl).
 * Demo-priced closes are excluded so they never pollute the ledger.
 */
export async function updateCycleOutcomes(db: { pool: Queryable }): Promise<{ linked: number; cyclesUpdated: number }> {
  const cyc = (await db.pool.query(
    `select id, started_at, config, thesis_ids,
            lead(started_at) over (order by started_at) next_start
     from cycles where started_at > now() - interval '7 days' order by started_at`,
  )).rows;
  let linked = 0, updated = 0;
  for (const c of cyc) {
    const props: { asset: string; direction: string }[] = c.config?.proposals ?? [];
    const have: string[] = c.thesis_ids ?? [];
    let ids = have;
    if (props.length) {
      const r = await db.pool.query(
        `select t.id from theses t
         where t.created_at >= $1 and t.created_at < least(coalesce($2::timestamptz,'infinity'), $1::timestamptz + interval '${LINK_WINDOW_HOURS} hours')
           and (t.asset || '/' || t.direction) = any($3::text[])
           and not exists (select 1 from cycles o where o.id <> $4 and t.id = any(o.thesis_ids))`,
        [c.started_at, c.next_start, props.map((p) => `${p.asset}/${p.direction}`), c.id],
      );
      ids = [...new Set([...have, ...r.rows.map((x) => x.id as string)])];
    }
    if (!ids.length) continue;
    const o = (await db.pool.query(
      `select count(*) filter (where status='closed' and demo=false)::int closed,
              count(*) filter (where status='closed' and demo=false and pnl>0)::int wins,
              coalesce(sum(pnl) filter (where status='closed' and demo=false),0) pnl
       from theses where id = any($1::uuid[])`,
      [ids],
    )).rows[0];
    const res = await db.pool.query(
      `update cycles set thesis_ids=$2::uuid[], closed=$3, wins=$4, pnl=$5
       where id=$1 and (thesis_ids is distinct from $2::uuid[] or closed<>$3 or wins<>$4 or pnl<>$5)`,
      [c.id, ids, o.closed, o.wins, o.pnl],
    );
    if (res.rowCount) { updated++; linked += ids.length - have.length; }
  }
  return { linked, cyclesUpdated: updated };
}
export const linkProposalsToCycles = updateCycleOutcomes;
