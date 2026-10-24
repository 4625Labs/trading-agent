"use client";
import Icon from "./Icon";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function usePoll<T>(url: string, ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) { window.location.href = "/login"; return; }
      const j = await r.json();
      if (!alive.current) return;
      if (!r.ok) throw new Error(j.error ?? "error");
      setData(j); setError(null); setAt(Date.now());
    } catch (e) { if (alive.current) setError((e as Error).message || "network error"); }
  }, [url]);
  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, ms);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, ms]);
  return { data, error, at, reload: load };
}

export async function post(url: string, b: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: j.error ?? `error ${r.status}` };
  } catch { return { ok: false, error: "network error" }; }
}

export const Card = ({ title, children, right, icon }: { title?: string; children: ReactNode; right?: ReactNode; icon?: string }) => (
  <section className="card">
    {(title || right) && <header><h2>{icon && <Icon name={icon} size={16} />}{title}</h2>{right}</header>}
    {children}
  </section>
);
export const Badge = ({ s }: { s: string }) => <span className={`badge b-${s.toLowerCase().replace(/^[^a-z]+/, "").replace(/[^a-z]+/g, "_")}`}>{s.replace(/_/g, " ")}</span>;
export const Stat = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | "warn" }) => (
  <div className="stat"><div className="lbl">{label}</div><div className={`val ${tone ?? ""}`}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>
);
export const Err = ({ msg }: { msg: string | null }) => (msg ? <div className="err" role="alert">{msg}</div> : null);
export const Loading = () => (
  <div aria-busy="true" aria-label="Loading">
    <div className="sk" style={{ height: 120, borderRadius: 22, marginBottom: 16 }} />
    <div className="grid">{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 84, borderRadius: 18 }} />)}</div>
    <div className="sk" style={{ height: 200, borderRadius: 18 }} />
  </div>
);
export const Empty = ({ children, icon = "inbox", title }: { children?: ReactNode; icon?: string; title?: string }) => (
  <div className="empty"><div className="orb"><Icon name={icon} size={24} /></div>{title && <b>{title}</b>}<div>{children}</div></div>
);
export const Title = ({ icon, children, at, error }: { icon: string; children: ReactNode; at?: number | null; error?: string | null }) => (
  <h1><span className="ttl"><span className="ic"><Icon name={icon} size={20} /></span>{children}</span>{at !== undefined && <Poll at={at} error={error ?? null} />}</h1>
);

/** Animated number: eases from the previous value to the new one. */
export function Count({ value, format = (n: number) => String(Math.round(n)) }: { value: number | null | undefined; format?: (n: number) => string }) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (value === null || value === undefined) return;
    const from = prev.current, to = value;
    if (from === to || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { prev.current = to; setV(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - p, 3);
      const cur = from + (to - from) * e; prev.current = cur; setV(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (value === null || value === undefined) return <>-</>;
  return <>{format(v)}</>;
}

export const usd = (n: number | null | undefined, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? "-" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
export const px = (n: number | null | undefined) => (n === null || n === undefined ? "-" : n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 }));
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n * 100) + "%");
export function ago(t: string | number | null | undefined) {
  if (!t) return "never";
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const Poll = ({ at, error }: { at: number | null; error: string | null }) => (
  <div className="poll" aria-live="polite"><span className={`dot ${error ? "bad" : at ? "ok" : ""}`} /> {error ? `offline: ${error}` : at ? "live" : "connecting"}</div>
);
export function host(u?: string | null) { try { return new URL(u!).hostname.replace(/^www\./, ""); } catch { return u ?? ""; } }
