"use client";
type P = { t: number; v: number };
const W = 640, H = 220, M = { l: 52, r: 12, t: 12, b: 24 };

export default function Chart({ series }: { series: { name: string; color: string; pts: P[] }[] }) {
  const all = series.flatMap((s) => s.pts);
  if (all.length < 2) return <div className="muted pad">Not enough trades yet to draw a PnL curve.</div>;
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t), t0 + 1);
  let lo = Math.min(0, ...all.map((p) => p.v)), hi = Math.max(0, ...all.map((p) => p.v));
  if (hi === lo) hi = lo + 1;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative PnL, synthetic versus real">
        {ticks.map((v, i) => (
          <g key={i}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" /><text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{v.toFixed(Math.abs(hi - lo) < 10 ? 2 : 0)}</text></g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} className="zero" />
        {series.map((s) => s.pts.length > 0 && (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round"
            points={[...s.pts, { t: t1, v: s.pts[s.pts.length - 1].v }].map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
        ))}
        <text x={M.l} y={H - 6} className="axis">{new Date(t0).toLocaleDateString()}</text>
        <text x={W - M.r} y={H - 6} textAnchor="end" className="axis">{new Date(t1).toLocaleDateString()}</text>
      </svg>
      <figcaption>{series.map((s) => <span key={s.name} className="key"><i style={{ background: s.color }} />{s.name}</span>)}</figcaption>
    </figure>
  );
}
