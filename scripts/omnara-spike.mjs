// Omnara spike: auto-approved custom tool `place_order` (guarded by our code) + ask_question human path.
// Run: node --experimental-strip-types --env-file=.env scripts/omnara-spike.mjs
import { evaluate } from "../apps/worker/src/guardrails.ts";
import { Simulator } from "../apps/worker/src/simulator.ts";

const T = process.env.OMNARA_ADMIN_TOKEN, B = "https://api.omnara.com/v1";
const api = async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!r.ok) throw new Error(`${m} ${p.replace(/\/orgs\/[^/]+/, "/orgs/<org>")} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const org = (await api("GET", "/orgs")).data[0].id;
const proj = (await api("GET", `/orgs/${org}/projects`)).data[0].id;
const base = `/orgs/${org}/projects/${proj}`;

const yaml = `version: v1
instruction: |
  You are a trading agent. To trade, call place_order. If place_order returns NEEDS_APPROVAL,
  call ask_question with prompt starting "Approve thesis <thesis_id>?" and options Approve / Reject,
  then retry place_order once if approved. Never retry if rejected. Keep replies short.
model:
  provider_config: omnara-openrouter
  name: anthropic/claude-fable-5.1
tools:
  ask_question: {}
  place_order:
    type: custom
    description: Place a trade. Guardrails run server-side and may require human approval.
    input_schema:
      type: object
      properties:
        thesis_id: { type: string }
        asset: { type: string }
        direction: { type: string, enum: [long, short] }
        size: { type: number, description: quote notional USD }
        entry: { type: number }
        stop: { type: number }
        target: { type: number }
        confidence: { type: number }
      required: [thesis_id, asset, direction, size, entry, stop, target, confidence]
`;
const prefs = { allowedAssets: ["BTC"], bannedAssets: [], maxPositionPct: 1, approvalThresholdUsd: 25, minConfidence: 0.5 };
const gstate = { walletUsd: 10000, openExposureUsd: 0, dailyPnlUsd: 0, ordersLastHour: 0, killSwitch: false };
const sim = new Simulator(async () => 100);
const approved = new Set();
const log = [];
const note = (s) => { log.push(s); console.log(s); };

const launched = await api("POST", `${base}/agents`, {
  config_source: { source: yaml, source_format: "yaml" },
  name: "trading-spike",
  message: "Go long BTC with $50 notional: thesis_id T1, entry 100, stop 95, target 110, confidence 0.8. Use place_order.",
});
const agent = launched.agent.id;
note(`launched agent (state=${launched.agent.state})`);

const seenTool = new Set(), seenInt = new Set();
let idleSince = 0;
for (let i = 0; i < 90; i++) {
  await sleep(2000);
  const calls = await api("GET", `${base}/agents/${agent}/tool-calls?state=ready&type=custom`).catch((e) => (note("tool-calls err: " + e.message), { data: [] }));
  for (const c of calls.data ?? []) {
    if (seenTool.has(c.id)) continue; seenTool.add(c.id);
    const a = c.input ?? c.arguments ?? c.args ?? {};
    const t = { id: a.thesis_id, asset: a.asset, direction: a.direction, entry: a.entry, size: a.size, stop: a.stop, target: a.target, rationale: "", confidence: a.confidence, signalIds: [] };
    const d = evaluate(t, prefs, gstate);
    note(`tool-call place_order -> guardrail ${d.verdict}${d.reasons.length ? " (" + d.reasons.join("; ") + ")" : ""}`);
    let result;
    if (d.verdict === "block") result = { outcome: "failed", content_blocks: [{ type: "text", text: "BLOCKED: " + d.reasons.join("; ") }] };
    else if (d.verdict === "needs_approval" && !approved.has(t.id)) result = { outcome: "failed", content_blocks: [{ type: "text", text: "NEEDS_APPROVAL: " + d.reasons.join("; ") }] };
    else { const f = await sim.placeOrder(t); result = { outcome: "succeeded", content_blocks: [{ type: "structured_data", value: { fillPrice: f.fillPrice, qty: f.qty, venue: f.venue } }] }; note("order filled on simulator"); }
    await api("POST", `${base}/agents/${agent}/tool-calls/${c.id}/result`, result).catch((e) => note("post result err: " + e.message));
  }
  const ints = await api("GET", `${base}/agents/${agent}/interactions?state=open`).catch((e) => (note("interactions err: " + e.message), { data: [] }));
  for (const it of ints.data ?? []) {
    if (seenInt.has(it.id)) continue; seenInt.add(it.id);
    const q = it.request?.questions?.[0];
    note(`interaction (${it.interaction_kind}): "${(q?.prompt ?? "").slice(0, 80)}" options=${(q?.options ?? []).map((o) => o.label).join("/")}`);
    const m = /thesis\s+(\w+)/i.exec(q?.prompt ?? "");
    const idx = (q?.options ?? []).findIndex((o) => /approve|allow/i.test(o.label));
    if (it.interaction_kind === "question" && idx >= 0) {
      if (m) approved.add(m[1]);
      await api("POST", `${base}/agents/${agent}/interactions/${it.id}/resolve`, { answers: [{ option_indices: [idx] }] });
      note("resolved interaction: Approve (simulated human)");
    }
  }
  const ag = await api("GET", `${base}/agents/${agent}`).catch(() => null);
  const st = ag?.activity?.state ?? ag?.agent?.activity?.state;
  if (st === "idle" && sim.positions.size) { if (!idleSince) idleSince = i; if (i - idleSince >= 2) break; }
}
const ev = await api("GET", `${base}/agents/${agent}/events?limit=100`).catch(() => ({ data: [] }));
console.log("events:", (ev.data ?? []).map((e) => e.kind ?? e.type).join(","));
console.log("RESULT", sim.positions.size ? "order placed after approval flow" : "no order placed");
