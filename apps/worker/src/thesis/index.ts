import type { Preferences } from "@trading-agent/shared";
import type { Db } from "../db.ts";
import type { Omnara } from "../omnara.ts";
import { parseJsonLoose, MODEL_THESIS } from "../ingest/llm.ts";
import type { LlmFn } from "../ingest/llm.ts";
import { buildThesisPrompt, THESIS_SYSTEM } from "./prompt.ts";
import type { SignalRow } from "./prompt.ts";
import { validateThesis } from "./validate.ts";
import type { ProposedThesis } from "./validate.ts";

export * from "./validate.ts";
export * from "./prompt.ts";

export interface ThesisDeps {
  llm: LlmFn;
  /** signals from the last 24h joined with source weight */
  readSignals: () => Promise<SignalRow[]>;
  prefs: () => Promise<Preferences>;
  /** latest lesson texts, newest first */
  lessons: () => Promise<string[]>;
  /** current price for an asset (e.g. BinanceTestnetAdapter.price) */
  price: (asset: string) => Promise<number>;
  walletUsd: number | (() => Promise<number>);
  log?: (m: string) => void;
}

export function pgThesisReaders(db: Db, lessonLimit = 10) {
  return {
    prefs: () => db.prefs(),
    async readSignals(): Promise<SignalRow[]> {
      const r = await db.pool.query(
        `select s.id, s.asset, s.direction, s.magnitude, s.horizon, s.confidence, s.url, coalesce(s.source_name,'unknown') source_name,
                coalesce(s.rationale,'') rationale, coalesce(src.weight,1.0) weight
         from signals s left join sources src on src.id=s.source_id
         where s.created_at > now() - interval '24 hours' order by s.created_at desc limit 60`,
      );
      return r.rows.map((x) => ({ ...x, magnitude: +x.magnitude, confidence: +x.confidence, weight: +x.weight }));
    },
    async lessons(): Promise<string[]> {
      return (await db.pool.query("select text from lessons order by created_at desc limit $1", [lessonLimit])).rows.map((x) => x.text);
    },
  };
}

/** Propose validated theses from recent signals. Invalid proposals are dropped (and logged). Never invents prices. */
export async function generateTheses(deps: ThesisDeps): Promise<ProposedThesis[]> {
  const log = deps.log ?? (() => {});
  const [signals, prefs, lessons] = await Promise.all([deps.readSignals(), deps.prefs(), deps.lessons()]);
  if (!signals.length) { log("thesis: no recent signals"); return []; }
  const walletUsd = typeof deps.walletUsd === "function" ? await deps.walletUsd() : deps.walletUsd;
  const assets = [...new Set(signals.map((s) => s.asset))].filter((a) => prefs.allowedAssets.includes(a) && !prefs.bannedAssets.includes(a));
  const prices: Record<string, number> = {};
  for (const a of assets) { try { prices[a] = await deps.price(a); } catch (e) { log(`price error ${a}: ${(e as Error).message}`); } }
  if (!Object.keys(prices).length) return [];
  const prompt = buildThesisPrompt({ signals: signals.filter((s) => s.asset in prices), prefs, lessons, prices, walletUsd });
  const text = await deps.llm({ model: MODEL_THESIS, system: THESIS_SYSTEM, prompt, maxTokens: 2500 });
  let j: any;
  try { j = parseJsonLoose(text); } catch (e) { log(`thesis: unparseable output (${(e as Error).message})`); return []; }
  const arr = Array.isArray(j) ? j : Array.isArray(j?.theses) ? j.theses : [];
  const ctx = { prices, prefs, walletUsd, knownSignalIds: new Set(signals.map((s) => s.id)) };
  const out: ProposedThesis[] = [];
  for (const raw of arr) {
    const v = validateThesis(raw, ctx);
    if (v.ok) out.push(v.thesis); else log(`thesis dropped: ${v.reason}`);
  }
  return out;
}

/** Instruction text sent to the agent so it calls place_order with exactly these fields. */
export function proposalText(t: ProposedThesis): string {
  const args = { asset: t.asset, direction: t.direction, size: t.size, entry: t.entry, stop: t.stop, target: t.target, confidence: t.confidence, rationale: t.rationale, signal_ids: t.signalIds };
  return `New trade thesis (${t.venueHint} venue). Call place_order exactly once with these fields, unchanged (do not alter any number):\n${JSON.stringify(args)}`;
}

export function proposeToAgent(omnara: Pick<Omnara, "send">, agentId: string, t: ProposedThesis) {
  return omnara.send(agentId, proposalText(t));
}
