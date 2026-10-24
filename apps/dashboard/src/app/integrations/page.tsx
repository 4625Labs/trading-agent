"use client";
import Integrations from "@/components/Integrations";
import { Err, Loading, Title, usePoll } from "@/components/ui";
export default function Page() {
  const { data, error, at } = usePoll<any>("/api/usage", 10000);
  return (
    <>
      <Title icon="integrations" at={at} error={error}>Integrations</Title>
      <Err msg={error && !data ? error : null} />
      {!data ? <Loading /> : <Integrations usage={data} full />}
    </>
  );
}
