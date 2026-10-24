"use client";
import EventCard from "@/components/EventCard";
import { Empty, Err, Loading, Poll, usePoll } from "@/components/ui";

export default function Trace() {
  const { data: d, error, at } = usePoll<any>("/api/trace");
  return (
    <>
      <h1>Trace <Poll at={at} error={error} /></h1>
      <p className="muted" style={{ marginTop: -6 }}>Everything the agent does, in plain English, newest first.</p>
      <Err msg={error && !d ? error : null} />
      {!d ? <Loading /> : !d.events.length ? <Empty>No activity recorded yet.</Empty> : <div className="timeline">{d.events.map((e: any) => <EventCard key={e.id} e={e} />)}</div>}
    </>
  );
}
