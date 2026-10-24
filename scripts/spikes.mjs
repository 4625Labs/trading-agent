// Connectivity spikes. Prints only OK/FAIL and status codes; never prints env values.
import { createHmac } from "node:crypto";
const e = process.env;
const missing = (...k) => k.filter((x) => !e[x]);
const results = [];
async function spike(name, needs, fn) {
  const m = missing(...needs);
  if (m.length) return results.push([name, "SKIP", `missing: ${m.join(",")}`]);
  try { results.push([name, "OK", await fn()]); }
  catch (err) { results.push([name, "FAIL", String(err.message ?? err).slice(0, 200)]); }
}
const get = async (url, headers) => { const r = await fetch(url, { headers }); return r; };

await spike("anthropic", ["ANTHROPIC_API_KEY"], async () => {
  const r = await get("https://api.anthropic.com/v1/models", { "x-api-key": e.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return `HTTP ${r.status}`;
});
await spike("supabase", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], async () => {
  const r = await get(`${e.SUPABASE_URL}/rest/v1/`, { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}` });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return `HTTP ${r.status}`;
});
await spike("context.dev", ["CONTEXT_DEV_API_KEY"], async () => {
  const r = await fetch("https://api.context.dev/v1/web/scrape", { method: "POST", headers: { Authorization: `Bearer ${e.CONTEXT_DEV_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com", formats: { markdown: true } }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(); return `HTTP ${r.status}, markdown chars=${j.markdown?.data?.length ?? 0}`;
});
await spike("binance-testnet", ["EXCHANGE_TESTNET_API_KEY", "EXCHANGE_TESTNET_API_SECRET"], async () => {
  const q = `timestamp=${Date.now()}&recvWindow=5000`;
  const sig = createHmac("sha256", e.EXCHANGE_TESTNET_API_SECRET).update(q).digest("hex");
  const r = await get(`${process.env.BINANCE_BASE ?? "https://testnet.binance.vision"}/api/v3/account?${q}&signature=${sig}`, { "X-MBX-APIKEY": e.EXCHANGE_TESTNET_API_KEY });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(); return `HTTP ${r.status}, funded assets=${j.balances.filter((b) => +b.free > 0).length}`;
});
await spike("omnara", ["OMNARA_ADMIN_TOKEN"], async () => {
  const r = await get("https://api.omnara.com/v1/orgs", { Authorization: `Bearer ${e.OMNARA_ADMIN_TOKEN}` });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(); const list = j.data ?? j.orgs ?? j;
  return `HTTP ${r.status}, orgs=${Array.isArray(list) ? list.map((o) => o.id).join(",") : "?"}`;
});
await spike("freestyle", ["FREESTYLE_API_KEY"], async () => {
  const { Freestyle } = await import("freestyle");
  const fs = new Freestyle();
  const { vm, vmId } = await fs.vms.create({ firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] } });
  try { const out = await vm.exec("echo hi"); return `vm exec status=${out.statusCode} stdout=${String(out.stdout).trim()}`; }
  finally { await fs.vms.delete(vmId); }
});
for (const [n, s, d] of results) console.log(`${s.padEnd(4)} ${n}: ${d}`);
