"use client";
const W = 640, H = 200, M = { l: 48, r: 10, t: 10, b: 22 };
export function DeltaBars({ values, label, fmt = (n: number) => n.toFixed(2) }: { values: number[]; label: string; fmt?: (n: number) => string }) {
  if (!values.length) return <div className="muted pad">No windows yet.</div>;
  const hi = Math.max(1e-9, ...values, 0), lo = Math.min(0, ...values);
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo || 1)) * (H - M.t - M.b);
  const bw = (W - M.l - M.r) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: "100%", height: "auto" }}>
      {[lo, hi].map((v, i) => <text key={i} x={M.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{fmt(v)}</text>)}
      {values.map((v, i) => <rect key={i} x={M.l + i * bw + 1} width={Math.max(1, bw - 2)} y={Math.min(y(v), y(0))} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={2} fill={v >= 0 ? "var(--pos)" : "var(--neg)"} opacity={0.9}><title>{fmt(v)}</title></rect>)}
      <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeDasharray="3 4" />
    </svg>
  );
}
export function Histogram({ bins, label }: { bins: { from: number; to: number; count: number }[]; label: string }) {
  if (!bins.length) return <div className="muted pad">No windows yet.</div>;
  const mx = Math.max(1, ...bins.map((b) => b.count)), bw = (W - M.l - M.r) / bins.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: "100%", height: "auto" }}>
      {bins.map((b, i) => { const h = (b.count / mx) * (H - M.t - M.b); return (
        <g key={i}><rect x={M.l + i * bw + 2} y={H - M.b - h} width={bw - 4} height={h} rx={3} fill={b.to <= 0 ? "var(--neg)" : b.from >= 0 ? "var(--pos)" : "var(--c1)"} opacity={0.85}><title>{`${b.from.toFixed(2)} to ${b.to.toFixed(2)}: ${b.count}`}</title></rect>
          {i % 2 === 0 && <text x={M.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="axis">{b.from.toFixed(1)}</text>}</g>); })}
      <text x={M.l - 6} y={M.t + 8} textAnchor="end" className="axis">{mx}</text>
    </svg>
  );
}
