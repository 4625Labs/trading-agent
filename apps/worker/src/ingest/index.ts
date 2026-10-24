import type { Db } from "../db.ts";
import { contextDev } from "./contextdev.ts";
import type { Article, ContextDev } from "./contextdev.ts";
import { anthropicLlm } from "./llm.ts";
import type { LlmFn } from "./llm.ts";
import { extractSignals, dedupeKey, hostOf } from "./extract.ts";
import type { ExtractedSignal } from "./extract.ts";
import { SEED_SOURCES, WATCHLIST_QUERIES } from "./watchlist.ts";

export * from "./extract.ts";
export * from "./llm.ts";
export * from "./contextdev.ts";
export * from "./watchlist.ts";

export interface SignalStore {
  /** find-or-create a sources row for a URL's domain; returns id and weight */
  sourceFor(url: string): Promise<{ id: string; weight: number }>;
  /** insert; returns new id, or null when raw_hash already exists (dupe) */
  insertSignal(s: ExtractedSignal, sourceId: string): Promise<string | null>;
  seedSources(): Promise<void>;
}

export function pgSignalStore(db: Pick<Db, "pool">): SignalStore {
  return {
    async sourceFor(url) {
      const domain = hostOf(url);
      const r = await db.pool.query("select id, weight from sources where url=$1 limit 1", [domain]);
      if (r.rows[0]) return { id: r.rows[0].id, weight: +r.rows[0].weight };
      const n = await db.pool.query("insert into sources(url) values ($1) returning id, weight", [domain]);
      return { id: n.rows[0].id, weight: +n.rows[0].weight };
    },
    async insertSignal(s, sourceId) {
      const r = await db.pool.query(
        `insert into signals(asset,direction,magnitude,horizon,confidence,source_id,url,rationale,source_name,raw_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (raw_hash) do nothing returning id`,
        [s.asset, s.direction, s.magnitude, s.horizon, s.confidence, sourceId, s.url, s.rationale, s.source, dedupeKey(s.url, s.asset)],
      );
      return r.rows[0]?.id ?? null;
    },
    async seedSources() {
      for (const s of SEED_SOURCES) {
        const r = await db.pool.query("select 1 from sources where url=$1 limit 1", [s.domain]);
        if (!r.rowCount) await db.pool.query("insert into sources(url,weight) values ($1,$2)", [s.domain, s.weight]);
      }
    },
  };
}

export interface IngestDeps {
  store: SignalStore;
  llm: LlmFn;
  ctx: Pick<ContextDev, "search">;
  queries?: { asset: string; query: string }[];
  resultsPerQuery?: number;
  maxArticles?: number;
  log?: (m: string) => void;
}
export interface IngestResult {
  searches: number;
  articles: number;
  extracted: number;
  inserted: number;
  duplicates: number;
  errors: number;
}

/** One ingest cycle: search -> extract -> dedupe -> insert. Never throws on per-item failures. */
export async function runIngest(deps: IngestDeps): Promise<IngestResult> {
  const log = deps.log ?? (() => {});
  const res: IngestResult = { searches: 0, articles: 0, extracted: 0, inserted: 0, duplicates: 0, errors: 0 };
  await deps.store.seedSources().catch(() => res.errors++);
  const seen = new Set<string>();
  const arts: Article[] = [];
  for (const q of deps.queries ?? WATCHLIST_QUERIES) {
    res.searches++;
    try {
      for (const a of await deps.ctx.search(q.query, deps.resultsPerQuery ?? 4)) {
        if (!seen.has(a.url)) { seen.add(a.url); arts.push(a); }
      }
    } catch (e) { res.errors++; log(`search error: ${(e as Error).message}`); }
  }
  const batch = arts.slice(0, deps.maxArticles ?? 12);
  res.articles = batch.length;
  for (const a of batch) {
    try {
      const sigs = await extractSignals(deps.llm, a);
      res.extracted += sigs.length;
      if (!sigs.length) continue;
      const src = await deps.store.sourceFor(a.url);
      for (const s of sigs) {
        const id = await deps.store.insertSignal(s, src.id);
        if (id) res.inserted++; else res.duplicates++;
      }
    } catch (e) { res.errors++; log(`extract error: ${(e as Error).message}`); }
  }
  log(`ingest: ${JSON.stringify(res)}`);
  return res;
}

/** Convenience: build deps from env + Db. */
export function defaultIngestDeps(db: Db, log?: (m: string) => void): IngestDeps {
  return { store: pgSignalStore(db), llm: anthropicLlm(), ctx: contextDev(), log };
}
