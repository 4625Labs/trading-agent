import { recordUsage } from "../usage.ts";

/** context.dev client (search + scrape). Key from env; errors never include URLs or keys. */
export interface Article {
  url: string;
  title: string;
  markdown: string;
}
export interface ContextDev {
  search(query: string, numResults?: number): Promise<Article[]>;
  scrape(url: string): Promise<Article | null>;
}

export function contextDev(apiKey = process.env.CONTEXT_DEV_API_KEY, base = "https://api.context.dev/v1"): ContextDev {
  if (!apiKey) throw new Error("CONTEXT_DEV_API_KEY not set");
  const post = async (path: string, body: unknown): Promise<any> => {
    let res: Response;
    try {
      res = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      recordUsage({ provider: "contextdev", endpoint: path, status: null });
      throw new Error(`context.dev ${path} request failed: ${(e as Error).name}`);
    }
    if (!res.ok) {
      recordUsage({ provider: "contextdev", endpoint: path, status: res.status });
      throw new Error(`context.dev ${path} -> ${res.status}`);
    }
    const out = await res.json();
    recordUsage({ provider: "contextdev", endpoint: path, status: res.status, creditsUsed: out?.key_metadata?.credits_consumed ?? null, creditsRemaining: out?.key_metadata?.credits_remaining ?? null });
    return out;
  };
  return {
    async search(query, numResults = 5) {
      const j = await post("/web/search", { query, numResults, freshness: "last_24_hours", markdownOptions: { enabled: true, useMainContentOnly: true } });
      return (j.results ?? [])
        .map((r: any) => ({ url: String(r.url ?? ""), title: String(r.title ?? ""), markdown: String(r.markdown?.markdown ?? r.markdown ?? "") }))
        .filter((a: Article) => a.url && a.markdown && typeof a.markdown === "string");
    },
    async scrape(url) {
      const j = await post("/web/scrape", { url, formats: { markdown: true }, sharedParams: { mainContentOnly: true } });
      const md = j.markdown?.markdown ?? j.markdown ?? j.data?.markdown ?? "";
      return typeof md === "string" && md ? { url, title: String(j.title ?? ""), markdown: md } : null;
    },
  };
}
