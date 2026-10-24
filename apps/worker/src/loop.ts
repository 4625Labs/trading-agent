import type { ExchangeAdapter, Thesis, TradeResult } from "@trading-agent/shared";
import type { Db } from "./db.ts";
import type { Interaction, Omnara, ToolCall } from "./omnara.ts";
import { evaluate } from "./guardrails.ts";
import { heartbeat } from "./health.ts";

export interface Venues {
  synthetic: ExchangeAdapter;
  real?: ExchangeAdapter & { freeBalance?(asset: string): Promise<number> };
}
export interface WorkerOpts {
  simulateHuman?: boolean; // auto-tap Approve (test mode only)
  log?: (s: string) => void;
}

export interface PlaceOrderResult {
  ok: boolean;
  text: string;
  data?: unknown;
}

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID = /thesis\s+([0-9a-f]{8}-[0-9a-f-]{27})/i;

export function argsOf(c: ToolCall): Record<string, any> {
  return (c.input ?? c.arguments ?? c.args ?? c.parameters ?? {}) as Record<string, any>;
}

/** Index of the option a human picked, tolerating a few plausible response shapes. */
export function chosenIndex(it: Interaction): number | undefined {
  const cands = [it.answers, (it as any).resolution?.answers, (it as any).response?.answers, (it as any).resolved?.answers];
  for (const a of cands) {
    const idx = Array.isArray(a) ? a[0]?.option_indices?.[0] : undefined;
    if (typeof idx === "number") return idx;
  }
  return undefined;
}

export class Worker {
  db: Db;
  omnara: Omnara;
  venues: Venues;
  agents = new Set<string>();
  opts: WorkerOpts;
  private seen = new Set<string>();
  private loggedShape = false;

  constructor(db: Db, omnara: Omnara, venues: Venues, opts: WorkerOpts = {}) {
    this.db = db;
    this.omnara = omnara;
    this.venues = venues;
    this.opts = opts;
  }
  private log(s: string) {
    (this.opts.log ?? console.log)(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
  }

  /** Core place_order policy: guardrails -> (human approval) -> synthetic + real execution, all persisted. */
  async handlePlaceOrder(agent: string, a: Record<string, any>): Promise<PlaceOrderResult> {
    const prefs = await this.db.prefs();
    const real = this.venues.real;
    const wallet = real?.freeBalance ? await real.freeBalance("USDT") : 10_000;
    const state = await this.db.guardrailState(wallet, !!prefs.killSwitch);

    let thesis: (Thesis & { status: string }) | null = a.thesis_id ? await this.db.getThesis(String(a.thesis_id)) : null;
    if (!thesis) {
      const draft = { asset: String(a.asset).toUpperCase(), direction: a.direction, entry: +a.entry, size: +a.size, stop: +a.stop, target: +a.target, rationale: String(a.rationale ?? ""), confidence: +a.confidence, signalIds: (Array.isArray(a.signal_ids) ? a.signal_ids : []).map(String).filter((x: string) => UUID_ONLY.test(x)) };
      const id = await this.db.insertThesis(draft, "proposed");
      thesis = { ...draft, id, status: "proposed" };
    }
    if (thesis.status === "executed") return { ok: true, text: `Already executed (thesis_id=${thesis.id}).` };

    const d = evaluate(thesis, prefs, state);
    await this.db.logGuardrail(thesis.id, d);
    this.log(`guardrail ${d.verdict} for ${thesis.asset} $${thesis.size}${d.reasons.length ? ": " + d.reasons.join("; ") : ""}`);

    if (d.verdict === "block") {
      await this.db.setThesisStatus(thesis.id, "blocked");
      return { ok: false, text: `BLOCKED: ${d.reasons.join("; ")}` };
    }
    if (d.verdict === "needs_approval") {
      await this.db.ensureApproval(thesis.id);
      await this.syncApprovals(agent);
      const st = await this.db.approvalStatus(thesis.id);
      if (st === "rejected") {
        await this.db.setThesisStatus(thesis.id, "rejected");
        return { ok: false, text: "REJECTED by the user. Do not retry." };
      }
      if (st !== "approved") {
        await this.db.setThesisStatus(thesis.id, "pending_approval");
        return { ok: false, text: `NEEDS_APPROVAL: ${d.reasons.join("; ")}. thesis_id=${thesis.id}` };
      }
    }
    return this.execute(thesis);
  }

  private async execute(t: Thesis): Promise<PlaceOrderResult> {
    const synth: TradeResult = await this.venues.synthetic.placeOrder(t);
    await this.db.recordSynthetic(synth);
    let realNote = "no real venue configured";
    let real: TradeResult | undefined;
    if (this.venues.real) {
      try {
        real = await this.venues.real.placeOrder(t);
        await this.db.recordReal(real);
        realNote = `filled on ${real.venue}`;
      } catch (e) {
        realNote = `real order failed: ${(e as Error).message}`;
      }
    }
    await this.db.setThesisStatus(t.id, "executed");
    this.log(`executed ${t.asset}: synthetic fill ${synth.fillPrice.toFixed(2)}; ${realNote}`);
    return { ok: true, text: `Executed. Synthetic fill ${synth.fillPrice.toFixed(2)}; real: ${realNote}.`, data: { synthetic: synth, real } };
  }

  /** Mirror human answers on Omnara questions into the approvals table. */
  async syncApprovals(agent: string) {
    const pending = new Set(await this.db.pendingApprovals());
    if (!pending.size) return;
    for (const it of await this.omnara.interactions(agent, "resolved")) {
      if (it.interaction_kind !== "question") continue;
      const q = it.request?.questions?.[0];
      const m = UUID.exec(q?.prompt ?? "");
      if (!m || !pending.has(m[1])) continue;
      if (!this.loggedShape) { this.loggedShape = true; this.log(`resolved interaction fields: ${Object.keys(it).join(",")}`); }
      const idx = chosenIndex(it);
      const label = idx === undefined ? undefined : q?.options[idx]?.label;
      if (label === undefined) { this.log("could not read the chosen option from the resolved interaction"); continue; }
      const approved = /^approve/i.test(label);
      await this.db.decideApproval(m[1], approved ? "approved" : "rejected", approved ? undefined : label);
      this.log(`human ${approved ? "APPROVED" : "REJECTED"} thesis ${m[1]} (answer: ${label})`);
    }
  }

  async tick() {
    for (const agent of this.agents) {
      for (const c of await this.omnara.readyToolCalls(agent)) {
        if (this.seen.has(c.id)) continue;
        this.seen.add(c.id);
        const name = c.name ?? c.tool_name;
        if (name && name !== "place_order") continue;
        let r: PlaceOrderResult;
        try { r = await this.handlePlaceOrder(agent, argsOf(c)); }
        catch (e) { r = { ok: false, text: `ERROR: ${(e as Error).message}` }; this.log(r.text); }
        await this.omnara.postResult(agent, c.id, r.ok, [r.data ? { type: "structured_data", value: r.data } : { type: "text", text: r.text }, ...(r.data ? [{ type: "text", text: r.text }] : [])]);
      }
      for (const it of await this.omnara.interactions(agent, "open")) {
        if (this.seen.has(it.id)) continue;
        this.seen.add(it.id);
        const q = it.request?.questions?.[0];
        this.log(`WAITING FOR HUMAN (${it.interaction_kind}): ${q?.prompt}`);
        if (this.opts.simulateHuman && it.interaction_kind === "question") {
          const idx = Math.max(0, (q?.options ?? []).findIndex((o) => /^approve/i.test(o.label)));
          await this.omnara.resolve(agent, it.id, idx);
          this.log("simulated human tapped Approve");
        }
      }
      await this.syncApprovals(agent);
    }
  }

  async run(intervalMs = 2000, stop: () => boolean = () => false) {
    while (!stop()) {
      try { await this.tick(); heartbeat.tick(); } catch (e) { this.log(`tick error: ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
