"use client";
import Icon from "./Icon";
import { Count } from "./ui";

function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data), w = 120, h = 34, bw = w / data.length;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Calls per hour, last 12 hours">
      {data.map((v, i) => { const bh = Math.max(2, (v / max) * (h - 2)); return <rect key={i} x={i * bw + 1} y={h - bh} width={bw - 2} height={bh} rx={2} fill="var(--c2)" opacity={v ? 0.9 : 0.25} />; })}
    </svg>
  );
}
const dur = (s?: number | null) => (s === null || s === undefined ? "-" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);

function Tile({ icon, name, p, unit = "calls", cls = "" }: { icon: string; name: string; p: any; unit?: string; cls?: string }) {
  return (
    <div className={`tile ${cls}`}>
      <div className="th"><Icon name={icon} size={16} />{name}</div>
      <div className="v num"><Count value={p?.total ?? 0} /> <span className="small muted">{unit}</span></div>
      <div className="sub">{p?.last24h ?? 0} in the last 24h{p?.errors ? ` · ${p.errors} errors` : ""}</div>
      <Spark data={p?.hourly ?? Array(12).fill(0)} />
    </div>
  );
}

export default function Integrations({ usage, full = false }: { usage: any; full?: boolean }) {
  const pr = usage?.providers ?? {};
  const c = pr.contextdev;
  const w = usage?.worker;
  return (
    <div className="tiles">
      <div className="tile feature">
        <div className="th"><Icon name="globe" size={16} />Web crawling by context.dev</div>
        <div className="feature-grid">
          <div><div className="v num"><Count value={c?.total ?? 0} /></div><div className="sub">search and scrape calls · {c?.last24h ?? 0} in 24h{c?.errors ? ` · ${c.errors} errors` : ""}</div></div>
          <div><div className="v num">{c?.creditsRemaining === null || c?.creditsRemaining === undefined ? "-" : <Count value={c.creditsRemaining} format={(n) => Math.round(n).toLocaleString()} />}</div><div className="sub">credits remaining</div></div>
        </div>
        <Spark data={c?.hourly ?? Array(12).fill(0)} />
        {full && !!c?.endpoints?.length && <div style={{ marginTop: 8 }}>{c.endpoints.map((e: any) => <div className="ep" key={e.endpoint}><span>{e.endpoint}</span><span className="num">{e.count}</span></div>)}</div>}
      </div>
      <Tile icon="bot" name="Claude" p={pr.anthropic} />
      <Tile icon="coins" name="Binance testnet" p={pr.binance} />
      <Tile icon="link" name="Omnara" p={pr.omnara} />
      <div className="tile">
        <div className="th"><Icon name="server" size={16} />Freestyle hosting</div>
        <div className="v num">{w ? dur(w.uptimeSec) : "-"}</div>
        <div className="sub">{!w ? "worker health not configured" : w.ok ? (w.uptimeSec !== null ? "worker uptime" : "worker healthy") : "worker health check failed"}</div>
      </div>
      <div className="tile">
        <div className="th"><Icon name="db" size={16} />Supabase</div>
        <div className="v num"><Count value={usage?.supabaseRowsToday ?? null} /></div>
        <div className="sub">rows written today</div>
      </div>
      {full && ["anthropic", "binance", "omnara"].map((k) => pr[k]?.endpoints?.length ? (
        <div className="tile" key={k}><div className="th">{k} endpoints</div>{pr[k].endpoints.map((e: any) => <div className="ep" key={e.endpoint}><span>{e.endpoint}</span><span className="num">{e.count}</span></div>)}</div>
      ) : null)}
    </div>
  );
}
