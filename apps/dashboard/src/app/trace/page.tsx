"use client";
import EventCard from "@/components/EventCard";
import { Empty, Err, Loading, Poll, usePoll, Title } from "@/components/ui";

export default function Trace() {
  const { data: d, error, at } = usePoll<any>("/api/trace");
  return (
    <>
      <Title icon="trace" at={at} error={error}>Trace</Title>
      <p className="muted" style={{ marginTop: -6 }}>Everything the agent does, in plain English, newest first.</p>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : !d.events.length ? <Empty icon="trace" title="No activity yet">Agent actions will show up here in plain English.</Empty> : <div className="timeline">{d.events.map((e: any) => <EventCard key={e.id} e={e} />)}</div>}
    </>
  );
}
