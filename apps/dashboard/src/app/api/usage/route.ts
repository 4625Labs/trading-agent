import { tryq } from "@/lib/db";
import { handle } from "@/lib/http";
export const dynamic = "force-dynamic";
const PROVIDERS = ["contextdev", "anthropic", "binance", "omnara"];

async function worker() {
  const url = process.env.WORKER_HEALTH_URL;
  if (!url) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); clearTimeout(t);
    let up: number | undefined;
    try { const j = await r.json(); const u = j?.uptimeSec ?? j?.uptimeS ?? j?.uptime_s ?? j?.uptime; if (typeof u === "number") up = u; } catch { /* not json */ }
    return { ok: r.ok, uptimeSec: up ?? null };
  } catch { return { ok: false, uptimeSec: null }; }
}

export function GET() {
  return handle(async () => {
    const [tot, hourly, credits, eps, rows] = await Promise.all([
      tryq(`select provider, count(*)::int total, (count(*) filter (where ts > now() - interval '24 hours'))::int c24,
                   (count(*) filter (where status is null or status >= 400))::int errors from api_usage group by provider`),
      tryq(`select provider, floor(extract(epoch from (now() - ts)) / 3600)::int ago, count(*)::int c from api_usage where ts > now() - interval '12 hours' group by 1,2`),
      tryq(`select distinct on (provider) provider, credits_remaining from api_usage where credits_remaining is not null order by provider, ts desc`),
      tryq(`select provider, endpoint, count(*)::int c from api_usage group by 1,2 order by c desc`),
      tryq(`select ((select count(*) from signals where created_at >= date_trunc('day', now()))
              + (select count(*) from theses where created_at >= date_trunc('day', now()))
              + (select count(*) from agent_events where ts >= date_trunc('day', now()))
              + (select count(*) from api_usage where ts >= date_trunc('day', now())))::int n`),
    ]);
    const providers: Record<string, any> = {};
    for (const p of PROVIDERS) {
      const t = tot.rows.find((r: any) => r.provider === p);
      const h = Array<number>(12).fill(0);
      for (const r of hourly.rows.filter((r: any) => r.provider === p)) if (r.ago >= 0 && r.ago < 12) h[11 - r.ago] = r.c;
      const c = credits.rows.find((r: any) => r.provider === p);
      providers[p] = {
        total: t?.total ?? 0, last24h: t?.c24 ?? 0, errors: t?.errors ?? 0, hourly: h,
        creditsRemaining: c?.credits_remaining === undefined || c?.credits_remaining === null ? null : Number(c.credits_remaining),
        endpoints: eps.rows.filter((r: any) => r.provider === p).slice(0, 6).map((r: any) => ({ endpoint: r.endpoint, count: r.c })),
      };
    }
    return { providers, worker: await worker(), supabaseRowsToday: rows.rows[0]?.n ?? null };
  });
}
