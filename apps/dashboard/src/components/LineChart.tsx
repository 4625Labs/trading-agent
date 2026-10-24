"use client";
import { useId, useState } from "react";
import Icon from "./Icon";
export interface S { name: string; color: string; pts: { x: number; y: number }[] }
const W = 640, H = 220, M = { l: 48, r: 12, t: 12, b: 26 };

export default function LineChart({ series, fmt = (n: number) => n.toFixed(2), area = true, zero = true, label }: { series: S[]; fmt?: (n: number) => string; area?: boolean; zero?: boolean; label: string }) {
  const uid = useId().replace(/:/g, "");
  const [off, setOff] = useState<Record<string, boolean>>({});
  const vis = series.filter((s) => !off[s.name]);
  const all = vis.flatMap((s) => s.pts);
  const legend = (
    <figcaption>{series.map((s) => (
      <button key={s.name} type="button" className="key legend" aria-pressed={!off[s.name]} onClick={() => setOff({ ...off, [s.name]: !off[s.name] })} style={{ opacity: off[s.name] ? 0.4 : 1 }}>
        <i style={{ background: s.color }} />{s.name.replace(/_/g, " ")}
      </button>
    ))}</figcaption>
  );
  if (series.every((s) => s.pts.length < 2)) return <div className="empty"><div className="orb"><Icon name="bars" size={22} /></div><b>No data yet</b></div>;
  const x0 = Math.min(...all.map((p) => p.x), Infinity), x1 = Math.max(...all.map((p) => p.x), x0 + 1);
  let lo = Math.min(...all.map((p) => p.y), zero ? 0 : Infinity), hi = Math.max(...all.map((p) => p.y), zero ? 0 : -Infinity);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi === lo) hi = lo + 1;
  const x = (v: number) => M.l + ((v - x0) / (x1 - x0)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>{series.map((s, i) => <linearGradient key={i} id={`${uid}g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.3} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
        {[lo, (lo + hi) / 2, hi].map((v, i) => <g key={i}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" /><text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{fmt(v)}</text></g>)}
        {zero && lo < 0 && hi > 0 && <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} className="zero" />}
        {series.map((s, i) => {
          if (off[s.name] || s.pts.length < 2) return null;
          const line = s.pts.map((p, j) => `${j ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
          const base = y(Math.max(lo, Math.min(hi, 0)));
          return <g key={s.name}>{area && series.length <= 2 && <path d={`${line} L${x(s.pts[s.pts.length - 1].x).toFixed(1)},${base} L${x(s.pts[0].x).toFixed(1)},${base}Z`} fill={`url(#${uid}g${i})`} />}
            <path d={line} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" /></g>;
        })}
        <text x={M.l} y={H - 6} className="axis">{x0}</text><text x={W - M.r} y={H - 6} textAnchor="end" className="axis">cycle {x1}</text>
      </svg>
      {legend}
    </figure>
  );
}
