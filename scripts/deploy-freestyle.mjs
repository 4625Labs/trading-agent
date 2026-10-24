#!/usr/bin/env node
// Freestyle deploy: node scripts/deploy-freestyle.mjs <deploy|redeploy|status|logs <unit>|restart|snapshot|destroy>
// Reads FREESTYLE_API_KEY (and the service vars) from the local .env; never prints values.
// Test knobs (env): DEPLOY_SRC, DEPLOY_STATE, DEPLOY_SLUG_PREFIX, DEPLOY_WORKER_UNIT, DEPLOY_DASH_UNIT,
//   DEPLOY_WORKER_EXEC, DEPLOY_DASH_EXEC, DEPLOY_SKIP_INSTALL=1, DEPLOY_SKIP_ENV=1, DEPLOY_ENV_KEYS (extra, comma list)
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Freestyle } from "freestyle";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(process.env.DEPLOY_SRC ?? REPO);
const STATE_FILE = resolve(process.env.DEPLOY_STATE ?? join(REPO, ".freestyle-deploy.json"));
const SLUG_PREFIX = process.env.DEPLOY_SLUG_PREFIX ?? "trading-agent";
const WORKER_UNIT = process.env.DEPLOY_WORKER_UNIT ?? "trading-worker";
const DASH_UNIT = process.env.DEPLOY_DASH_UNIT ?? "trading-dashboard";
const DASH_PORT = 3000, WORKER_PORT = 8080;
const BUN = "/usr/local/bin/bun";
const WORKER_EXEC = process.env.DEPLOY_WORKER_EXEC ?? "/bin/bash /root/app/deploy/run-worker.sh";
const DASH_EXEC = process.env.DEPLOY_DASH_EXEC ?? `${BUN} --bun run --cwd apps/dashboard start`;
// Variables copied from local .env to the VM. FREESTYLE_API_KEY is deliberately NOT included.
export const ENV_KEYS = [
  "DATABASE_URL", "OMNARA_ADMIN_TOKEN", "EXCHANGE_TESTNET_API_KEY", "EXCHANGE_TESTNET_API_SECRET", "EXCHANGE_TESTNET_URL",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ANTHROPIC_API_KEY", "CONTEXT_DEV_API_KEY", "HIL_SIM", "WORKER_ARGS", "APP_VERSION",
  ...(process.env.DEPLOY_ENV_KEYS ?? "").split(",").filter(Boolean),
];
const EXCLUDES = [".env", ".env.*", "node_modules", ".git", ".next", ".freestyle-deploy.json", ".agent-id", "dist", ".DS_Store"];

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s ?? "").replace(/(key|token|secret|password|DATABASE_URL)[^\s]*/gi, "$1=<redacted>").slice(0, 600);

function loadDotenv() {
  const p = join(REPO, ".env");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const dotenv = loadDotenv();
if (!process.env.FREESTYLE_API_KEY && dotenv.FREESTYLE_API_KEY) process.env.FREESTYLE_API_KEY = dotenv.FREESTYLE_API_KEY;

const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const writeState = (s) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

let fs_;
const freestyle = () => (fs_ ??= new Freestyle());

async function sh(vm, cmd, { timeoutMs = 290_000, check = true, env } = {}) {
  const r = await vm.linuxUser("root").exec({ command: cmd, timeoutMs, ...(env ? { env } : {}) });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (check && r.statusCode !== 0) throw new Error(`remote command failed (${r.statusCode}): ${redact(out)}`);
  return out;
}

async function ensureVm(state) {
  if (state.vmId) {
    try { const vm = freestyle().vms.ref(state.vmId); await vm.data(); return vm; }
    catch { log(`state VM ${state.vmId} not found; creating a new one`); delete state.vmId; }
  }
  const { vm, vmId } = await freestyle().vms.create({
    firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] },
    idleTimeoutSeconds: -1, autoDeleteSeconds: -1, ttlSeconds: -1, maxRunSeconds: -1,
  });
  state.vmId = vmId;
  state.slug ??= `${SLUG_PREFIX}-${randomBytes(2).toString("hex")}`;
  writeState(state);
  log(`created VM ${vmId}`);
  return vm;
}

async function applyLimits(vm) {
  try { await vm.update({ idleTimeoutSeconds: -1, autoDeleteSeconds: -1, ttlSeconds: -1, maxRunSeconds: -1 }); }
  catch (e) { log("warn: could not clear all VM limits:", redact(e.message)); await vm.update({ idleTimeoutSeconds: -1 }); }
}

function pack() {
  const dir = mkdtempSync(join(tmpdir(), "deploy-"));
  const tgz = join(dir, "app.tgz");
  const args = ["-czf", tgz, ...EXCLUDES.flatMap((e) => ["--exclude", e]), "-C", SRC, "."];
  execFileSync("tar", args, { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const buf = readFileSync(tgz);
  rmSync(dir, { recursive: true, force: true });
  return buf;
}

async function sync(vm) {
  const t0 = Date.now();
  const buf = pack();
  await vm.fs.writeFile("/root/app.tgz", new Uint8Array(buf), { mode: 0o600 });
  await sh(vm, "mkdir -p /root/app && tar -xzf /root/app.tgz -C /root/app && rm -f /root/app.tgz && chmod +x /root/app/deploy/*.sh 2>/dev/null || true");
  log(`synced code (${(buf.length / 1024).toFixed(0)} KiB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function writeEnv(vm) {
  if (process.env.DEPLOY_SKIP_ENV === "1") { await sh(vm, "touch /root/app/.env && chmod 600 /root/app/.env"); return; }
  const lines = []; const names = [];
  for (const k of ENV_KEYS) {
    const v = process.env[k] ?? dotenv[k];
    if (v === undefined || v === "") continue;
    lines.push(`${k}=${JSON.stringify(v)}`); names.push(k);
  }
  await vm.fs.writeFile("/root/app/.env", lines.join("\n") + "\n", { mode: 0o600 });
  await sh(vm, "chmod 600 /root/app/.env");
  log(`wrote /root/app/.env with ${names.length} vars: ${names.join(", ")}`);
}

async function installAndBuild(vm) {
  if (process.env.DEPLOY_SKIP_INSTALL === "1" || !existsSync(join(SRC, "package.json"))) return;
  const t0 = Date.now();
  await sh(vm, `cd /root/app && ${BUN} install`);
  log(`bun install ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const hasDash = existsSync(join(SRC, "apps/dashboard/package.json"));
  if (hasDash) {
    const t1 = Date.now();
    await sh(vm, `cd /root/app && set -a && . /root/app/.env && set +a && ${BUN} --bun run --cwd apps/dashboard build`);
    log(`dashboard build ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  } else log("no apps/dashboard; skipping build");
}

function unitText(tplName, subs) {
  let t = readFileSync(join(REPO, "deploy", tplName), "utf8");
  for (const [k, v] of Object.entries(subs)) t = t.replaceAll(`{{${k}}}`, v);
  return t;
}

async function installUnits(vm) {
  const hasDash = DASH_EXEC !== `${BUN} --bun run --cwd apps/dashboard start` || existsSync(join(SRC, "apps/dashboard/package.json"));
  const subs = { WORKER_PORT, DASH_PORT, WORKER_EXEC, DASH_EXEC };
  await vm.fs.writeFile(`/etc/systemd/system/${WORKER_UNIT}.service`, unitText("trading-worker.service", subs), { mode: 0o644 });
  const units = [WORKER_UNIT];
  if (hasDash) {
    await vm.fs.writeFile(`/etc/systemd/system/${DASH_UNIT}.service`, unitText("trading-dashboard.service", subs), { mode: 0o644 });
    units.push(DASH_UNIT);
  } else log("no dashboard; dashboard unit not installed");
  await sh(vm, `systemctl daemon-reload && systemctl enable ${units.join(" ")} && systemctl restart ${units.join(" ")}`);
  return units;
}

async function ensureTls(state) {
  const want = [
    [`${state.slug}.style.dev`, DASH_PORT, "dashboard"],
    [`${state.slug}-worker.style.dev`, WORKER_PORT, "worker"],
  ];
  const existing = (await freestyle().tls.rules.list({ vmId: state.vmId })).rules;
  state.tlsRules ??= {};
  for (const [domain, port, key] of want) {
    const hit = existing.find((r) => r.domain === domain && r.destination?.port === port);
    if (hit) { state.tlsRules[key] = hit.id; continue; }
    const r = await freestyle().tls.rules.create({ action: "allow", domain, source: { public: true }, destination: { vmId: state.vmId, port } });
    state.tlsRules[key] = r.id;
    log(`tls rule ${domain} -> :${port}`);
  }
  state.dashboardUrl = `https://${want[0][0]}`;
  state.workerUrl = `https://${want[1][0]}`;
  writeState(state);
}

async function check(url, label, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) { log(`  ${label}: ${url} -> HTTP ${r.status}`); return true; }
    } catch {}
    await sleep(3000);
  }
  log(`  ${label}: ${url} NOT reachable`);
  return false;
}

async function statusOf(vm, units) {
  return sh(vm, `systemctl is-active ${units.join(" ")} | paste -sd' ' ; ` + units.map((u) => `echo "${u}: $(systemctl is-active ${u}) restarts=$(systemctl show ${u} -p NRestarts --value)"`).join("; "), { check: false });
}

const knownUnits = () => [WORKER_UNIT, DASH_UNIT];

async function getVm(state) {
  if (!state.vmId) throw new Error(`no VM recorded in ${STATE_FILE}; run deploy first`);
  return freestyle().vms.ref(state.vmId);
}

const commands = {
  async deploy() {
    const state = readState();
    const vm = await ensureVm(state);
    await applyLimits(vm);
    await sync(vm);
    await writeEnv(vm);
    await installAndBuild(vm);
    const units = await installUnits(vm);
    await ensureTls(state);
    state.units = units; state.deployedAt = new Date().toISOString(); writeState(state);
    await sleep(3000);
    log("units:\n" + await statusOf(vm, units));
    await check(state.workerUrl, "worker health");
    if (units.includes(DASH_UNIT)) await check(state.dashboardUrl, "dashboard");
    log(`\ndashboard: ${state.dashboardUrl}\nworker health: ${state.workerUrl}/health\nvm: ${state.vmId}`);
  },
  async redeploy() {
    const t0 = Date.now();
    const state = readState();
    const vm = await getVm(state);
    await sync(vm);
    // refresh the env too (cheap) unless explicitly skipped, then install/build only when asked
    await writeEnv(vm);
    if (process.env.REDEPLOY_INSTALL === "1") await installAndBuild(vm);
    const units = state.units ?? [WORKER_UNIT];
    await sh(vm, `systemctl restart ${units.join(" ")}`);
    await sleep(2000);
    await check(state.workerUrl, "worker health", 10);
    log(`redeploy done in ${((Date.now() - t0) / 1000).toFixed(1)}s (set REDEPLOY_INSTALL=1 to also bun install + build)`);
  },
  async status() {
    const state = readState(); const vm = await getVm(state);
    log(`vm ${state.vmId} state=${(await vm.data()).state}`);
    log(await statusOf(vm, state.units ?? knownUnits()));
    await check(state.workerUrl, "worker health", 2);
    await check(state.dashboardUrl, "dashboard", 2);
  },
  async logs(unit = WORKER_UNIT) {
    const state = readState(); const vm = await getVm(state);
    if (!/^[\w.@-]+$/.test(unit)) throw new Error("bad unit name");
    log(await sh(vm, `journalctl -u ${unit} -n ${process.env.LINES ?? 100} --no-pager`, { check: false }));
  },
  async restart() {
    const state = readState(); const vm = await getVm(state);
    const units = state.units ?? [WORKER_UNIT];
    await sh(vm, `systemctl restart ${units.join(" ")}`);
    log(await statusOf(vm, units));
  },
  async snapshot() {
    const state = readState(); const vm = await getVm(state);
    const s = await vm.snapshot({});
    (state.snapshots ??= []).push({ id: s.snapshotId, at: new Date().toISOString() }); writeState(state);
    log(`snapshot ${s.snapshotId}\nrollback: new VM from snapshot via freestyle.vms.create({snapshotId}) -- see docs/DEPLOY.md`);
  },
  async rmsnapshot(id) { await freestyle().vms.snapshots.delete(id); log("deleted", id); },
  async sh(...parts) {
    const state = readState(); const vm = await getVm(state);
    log(await sh(vm, parts.join(" "), { check: false }));
  },
  async destroy() {
    const state = readState();
    for (const id of Object.values(state.tlsRules ?? {})) { try { await freestyle().tls.rules.delete(id); } catch (e) { log("tls delete:", redact(e.message)); } }
    if (state.vmId) { try { await freestyle().vms.delete(state.vmId); } catch (e) { log("vm delete:", redact(e.message)); } }
    if (process.argv.includes("--snapshots")) for (const sn of state.snapshots ?? []) { try { await freestyle().vms.snapshots.delete(sn.id); } catch (e) { log("snapshot delete:", redact(e.message)); } }
    else if (state.snapshots?.length) log(`kept snapshots (use --snapshots to delete): ${state.snapshots.map((x) => x.id).join(", ")}`);
    rmSync(STATE_FILE, { force: true });
    log("destroyed VM and tls rules; state file removed");
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!commands[cmd]) { console.error("usage: deploy-freestyle.mjs deploy|redeploy|status|logs <unit>|restart|snapshot|sh <cmd>|rmsnapshot <id>|destroy [--snapshots]"); process.exit(2); }
try { await commands[cmd](...rest); }
catch (e) { console.error("ERROR:", redact(e.message)); process.exit(1); }
