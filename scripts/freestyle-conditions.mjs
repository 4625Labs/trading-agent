// Empirical Freestyle worker test: systemd service (as root), heartbeat, public domain, idle pause/wake. Cleans up after itself.
import { Freestyle } from "freestyle";
const fs = new Freestyle();
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const domain = `ta-spike-${Date.now().toString(36)}.style.dev`;
const { vm, vmId } = await fs.vms.create({ firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] }, idleTimeoutSeconds: -1 });
const root = vm.linuxUser("root");
const sh = async (c) => { const r = await root.exec(c); return (r.stdout + (r.stderr ?? "")).trim(); };
const beats = async (label) => console.log(label, "->", (await sh("echo beats=$(wc -l < /root/hb.log) last_age_s=$(( $(date +%s) - $(tail -1 /root/hb.log | cut -c1-10) ))")));
try {
  await sh(`cat > /root/server.js <<'EOS'
setInterval(() => require("fs").appendFileSync("/root/hb.log", Date.now() + "\\n"), 5000);
Bun.serve({ port: 3000, hostname: "0.0.0.0", fetch: () => new Response("ok " + Date.now()) });
EOS
cat > /etc/systemd/system/app.service <<'EOS'
[Service]
ExecStart=/usr/local/bin/bun /root/server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOS
systemctl daemon-reload && systemctl enable --now app`);
  await fs.tls.rules.create({ action: "allow", domain, source: { public: true }, destination: { vmId, port: 3000 } });
  await sleep(15);
  const r1 = await fetch(`https://${domain}`); console.log("A) https", r1.status, (await r1.text()).slice(0, 20));
  await beats("A) heartbeats (idle timeout off)");
  // B: idle timeout 30s, no inbound traffic for 90s
  await vm.update({ idleTimeoutSeconds: 30 });
  await sleep(90);
  const t0 = Date.now();
  const r2 = await fetch(`https://${domain}`).catch((e) => ({ status: "ERR " + e.message }));
  console.log("B) https after idle:", r2.status, `${Date.now() - t0}ms`);
  await sleep(10); await beats("B) heartbeats after request");
  console.log("C) max heartbeat gap (s):", await sh(`awk 'NR>1{d=($1-p)/1000; if(d>m)m=d} {p=$1} END{print m}' /root/hb.log`));
} catch (e) { console.log("ERROR", String(e.message).slice(0, 300)); }
finally { await fs.vms.delete(vmId); console.log("cleaned up"); }
