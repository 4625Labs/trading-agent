import { q } from "./db";
import { HttpError } from "./http";

export const DEFAULT_PREFS = { allowedAssets: ["BTC", "ETH", "SOL"], bannedAssets: [] as string[], maxPositionPct: 0.05, approvalThresholdUsd: 25, minConfidence: 0.5 };

export async function readPrefs(): Promise<Record<string, any>> {
  const r = await q("select data from preferences where user_id='default' order by updated_at desc limit 1");
  return { ...DEFAULT_PREFS, ...(r[0]?.data ?? {}) };
}
/** Atomic jsonb merge so we never clobber fields the worker writes (e.g. killSwitch). */
export async function mergePrefs(patch: Record<string, unknown>) {
  const cur = await q("select id from preferences where user_id='default' order by updated_at desc limit 1");
  if (cur[0]) await q("update preferences set data = data || $2::jsonb, updated_at=now() where id=$1", [cur[0].id, JSON.stringify(patch)]);
  else await q("insert into preferences(user_id,data) values ('default',$1::jsonb)", [JSON.stringify({ ...DEFAULT_PREFS, ...patch })]);
}

const assets = (v: unknown, name: string): string[] => {
  if (!Array.isArray(v) || v.length > 50) throw new HttpError(400, `${name} must be a list (max 50)`);
  const out = v.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  for (const a of out) if (!/^[A-Z0-9]{2,12}$/.test(a)) throw new HttpError(400, `${name}: invalid symbol`);
  return [...new Set(out)];
};
const range = (v: unknown, name: string, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (v === "" || v === null || !Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${name} must be between ${lo} and ${hi}`);
  return n;
};
export function validatePrefs(b: any) {
  const p = {
    allowedAssets: assets(b.allowedAssets, "allowedAssets"),
    bannedAssets: assets(b.bannedAssets, "bannedAssets"),
    maxPositionPct: range(b.maxPositionPct, "maxPositionPct", 0, 1),
    approvalThresholdUsd: range(b.approvalThresholdUsd, "approvalThresholdUsd", 0, 1e9),
    minConfidence: range(b.minConfidence, "minConfidence", 0, 1),
  };
  return p;
}
