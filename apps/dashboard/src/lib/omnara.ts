import { q } from "./db";
import { classify, findInteraction, optionIndex, type Interaction, type Kind } from "./match";

const BASE = "https://api.omnara.com/v1";
async function req(method: string, path: string, body?: unknown): Promise<any> {
  const token = process.env.OMNARA_ADMIN_TOKEN;
  if (!token) throw new Error("OMNARA_ADMIN_TOKEN not set");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(BASE + path, { method, signal: ctl.signal, cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch { /* text */ }
    if (!res.ok) throw new Error(`omnara ${method} -> ${res.status}`);
    return json;
  } finally { clearTimeout(timer); }
}

let ctx: { org: string; project: string; at: number } | null = null;
async function context() {
  if (ctx && Date.now() - ctx.at < 300_000) return ctx;
  const org = (await req("GET", "/orgs")).data[0].id as string;
  const project = (await req("GET", `/orgs/${org}/projects`)).data[0].id as string;
  return (ctx = { org, project, at: Date.now() });
}

export async function agentIds(): Promise<string[]> {
  try {
    const rows = await q<{ id: string }>("select id from agents where status='active' order by created_at desc");
    if (rows.length) return rows.map((r) => r.id);
  } catch { /* table may not exist yet */ }
  try {
    const { org } = await context();
    const r = await req("GET", `/orgs/${org}/agents`);
    const list: any[] = r?.data ?? r?.agents ?? [];
    return list.filter((a) => a?.name === "trading-agent").map((a) => a.id as string);
  } catch { return []; }
}

export interface OpenInteraction { agent: string; it: Interaction }
export async function openInteractions(): Promise<{ items: OpenInteraction[]; error?: string }> {
  try {
    const { org, project } = await context();
    const agents = await agentIds();
    const items: OpenInteraction[] = [];
    await Promise.all(agents.map(async (agent) => {
      try {
        const r = await req("GET", `/orgs/${org}/projects/${project}/agents/${agent}/interactions?state=open`);
        for (const it of (r?.data ?? []) as Interaction[]) items.push({ agent, it });
      } catch { /* agent may be gone */ }
    }));
    return { items };
  } catch (e) { return { items: [], error: "omnara unavailable" }; }
}

/** Resolve the open interaction for a thesis. Returns false when none is open. */
export async function resolveFor(thesisId: string, kind: Kind, choice: string): Promise<{ ok: boolean; error?: string }> {
  const { items } = await openInteractions();
  const hit = items.find((x) => findInteraction([x.it], thesisId, kind));
  if (!hit) return { ok: false, error: "no open question found for this thesis (it may already be answered)" };
  const idx = optionIndex(hit.it, choice);
  if (idx < 0) return { ok: false, error: "option not available on this question" };
  const { org, project } = await context();
  await req("POST", `/orgs/${org}/projects/${project}/agents/${hit.agent}/interactions/${hit.it.id}/resolve`, { answers: [{ option_indices: [idx] }] });
  return { ok: true };
}
export { classify };
