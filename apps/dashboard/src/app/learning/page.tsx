"use client";
import { Card, Empty, Err, Loading, Poll, ago, host, usePoll } from "@/components/ui";

function Generic({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty>No rows yet.</Empty>;
  const cols = Object.keys(rows[0]).filter((c) => !/^id$|_id$/.test(c)).slice(0, 6);
  return (
    <div className="scroll"><table className="table"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="num">{typeof r[c] === "object" && r[c] !== null ? JSON.stringify(r[c]).slice(0, 80) : String(r[c] ?? "-").slice(0, 80)}</td>)}</tr>)}</tbody></table></div>
  );
}

export default function Learning() {
  const { data: d, error, at } = usePoll<any>("/api/learning", 10000);
  return (
    <>
      <h1>Learning <Poll at={at} error={error} /></h1>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          <Card title="Sources and weights">
            {!d.sources.length ? <Empty>No sources yet.</Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>Source</th><th>Weight</th><th>Signals</th></tr></thead>
                <tbody>{d.sources.map((s: any) => (
                  <tr key={s.id}><td title={s.url}>{host(s.url)}</td>
                    <td className="num"><span style={{ display: "inline-block", width: 70, height: 6, background: "var(--surface2)", borderRadius: 3, marginRight: 8, verticalAlign: "middle" }}><span style={{ display: "block", height: 6, width: `${Math.min(100, (s.weight / 2) * 100)}%`, background: "var(--accent)", borderRadius: 3 }} /></span>{Number(s.weight).toFixed(2)}</td>
                    <td className="num">{s.signals}</td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
          <Card title="Lessons">
            {!d.lessons.length ? <Empty>No lessons recorded yet.</Empty> : d.lessons.map((l: any) => (
              <div className="item" key={l.id}><div>{l.text}</div><div className="muted" style={{ fontSize: ".8rem" }}>{l.origin ?? "unknown"} · {ago(l.created_at)}</div></div>
            ))}
          </Card>
          <Card title="Calibration">{d.calibration ? <Generic rows={d.calibration} /> : <Empty>Calibration data not available yet.</Empty>}</Card>
          {d.learningEvents && <Card title="Learning events"><Generic rows={d.learningEvents} /></Card>}
        </>
      )}
    </>
  );
}
