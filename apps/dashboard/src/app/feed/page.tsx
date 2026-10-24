"use client";
import { Badge, Card, Empty, Err, Loading, Poll, ago, host, pct, px, usd, usePoll, Title } from "@/components/ui";

export default function Feed() {
  const { data: d, error, at } = usePoll<any>("/api/feed");
  return (
    <>
      <Title icon="feed" at={at} error={error}>Feed</Title>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : (
        <>
          <Card title="Theses" right={<span className="muted">{d.theses.length}</span>}>
            {!d.theses.length ? <Empty icon="bulb" title="No theses yet">Ideas the agent proposes will appear here.</Empty> : d.theses.map((t: any) => (
              <div className="item" key={t.id}>
                <div className="row"><div><b>{t.asset}</b> <Badge s={t.direction} /></div><Badge s={t.status ?? "open"} /></div>
                <p>{t.rationale || "No rationale recorded."}</p>
                <div className="levels"><span>Entry <b>{px(t.entry)}</b></span><span>Stop <b>{px(t.stop)}</b></span><span>Target <b>{px(t.target)}</b></span><span>Size <b>{usd(t.size)}</b></span><span>Conf <b>{pct(t.confidence)}</b></span><span className="muted">{ago(t.created_at)}</span></div>
                <a className="tracelink" href={`/trace/${t.id}`}>Why this trade?</a>
              </div>
            ))}
          </Card>
          <Card title="Signals" right={<span className="muted">{d.signals.length}</span>}>
            {!d.signals.length ? <Empty icon="radio" title="No signals yet">News signals will appear here once ingested.</Empty> : (
              <div className="scroll"><table className="table"><thead><tr><th>Asset</th><th>Dir</th><th>Conf</th><th>Source</th><th>Link</th><th>When</th></tr></thead>
                <tbody>{d.signals.map((s: any) => (
                  <tr key={s.id}><td><b>{s.asset}</b></td><td><Badge s={s.direction ?? "n/a"} /></td><td className="num">{pct(s.confidence)}</td><td>{host(s.source)}</td>
                    <td>{/^https?:\/\//.test(s.url ?? "") ? <a href={s.url} target="_blank" rel="noopener noreferrer">open</a> : "-"}</td><td className="muted">{ago(s.created_at)}</td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
