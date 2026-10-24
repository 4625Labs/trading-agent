/** Minimal Omnara REST client for the worker. Token comes from env; never logged. */
export interface Interaction {
  id: string;
  interaction_kind: string;
  state: string;
  request?: { questions?: { prompt: string; options: { label: string }[] }[] };
  [k: string]: unknown;
}
export interface ToolCall {
  id: string;
  name?: string;
  tool_name?: string;
  [k: string]: unknown;
}

export class Omnara {
  private token: string;
  private base: string;
  orgId = "";
  projectId = "";
  constructor(token: string, base = "https://api.omnara.com/v1") {
    this.token = token;
    this.base = base;
  }
  static fromEnv(env: Record<string, string | undefined> = process.env) {
    if (!env.OMNARA_ADMIN_TOKEN) throw new Error("OMNARA_ADMIN_TOKEN not set");
    return new Omnara(env.OMNARA_ADMIN_TOKEN);
  }
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(this.base + path, { method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    if (!res.ok) throw new Error(`omnara ${method} ${path.replace(/\/orgs\/[^/]+/, "/orgs/<org>")} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }
  async init() {
    this.orgId = (await this.req("GET", "/orgs")).data[0].id;
    this.projectId = (await this.req("GET", `/orgs/${this.orgId}/projects`)).data[0].id;
    return this;
  }
  private p(agent: string) {
    return `/orgs/${this.orgId}/projects/${this.projectId}/agents/${agent}`;
  }
  async launch(yaml: string, message: string, name: string): Promise<string> {
    const r = await this.req("POST", `/orgs/${this.orgId}/projects/${this.projectId}/agents`, { config_source: { source: yaml, source_format: "yaml" }, name, message });
    return r.agent.id;
  }
  async send(agent: string, text: string) {
    return this.req("POST", `${this.p(agent)}/inputs`, { content_blocks: [{ type: "text", text }] });
  }
  async readyToolCalls(agent: string): Promise<ToolCall[]> {
    return (await this.req("GET", `${this.p(agent)}/tool-calls?state=ready&type=custom`)).data ?? [];
  }
  postResult(agent: string, id: string, ok: boolean, blocks: unknown[]) {
    return this.req("POST", `${this.p(agent)}/tool-calls/${id}/result`, { outcome: ok ? "succeeded" : "failed", content_blocks: blocks });
  }
  async interactions(agent: string, state: "open" | "resolved"): Promise<Interaction[]> {
    return (await this.req("GET", `${this.p(agent)}/interactions?state=${state}`)).data ?? [];
  }
  resolve(agent: string, id: string, optionIndex: number) {
    return this.req("POST", `${this.p(agent)}/interactions/${id}/resolve`, { answers: [{ option_indices: [optionIndex] }] });
  }
  async state(agent: string): Promise<string | undefined> {
    const a = await this.req("GET", this.p(agent)).catch(() => null);
    return a?.activity?.state ?? a?.agent?.activity?.state;
  }
}
