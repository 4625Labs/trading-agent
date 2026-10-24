import { q } from "@/lib/db";
import { HttpError, body, handle } from "@/lib/http";
import { DEFAULT_CONFIG, validateConfig } from "@/lib/config";
export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const r = await q("select data,updated_at from agent_config where id='default'");
    return { config: { ...DEFAULT_CONFIG, ...(r[0]?.data ?? {}) }, saved: !!r[0], updatedAt: r[0]?.updated_at ?? null };
  });
}
export function POST(req: Request) {
  return handle(async () => {
    const c = validateConfig(await body(req));
    if (typeof c === "string") throw new HttpError(400, c);
    await q(`insert into agent_config(id,data) values ('default',$1::jsonb)
             on conflict (id) do update set data = agent_config.data || excluded.data, updated_at=now()`, [JSON.stringify(c)]);
    return { ok: true, config: c };
  });
}
