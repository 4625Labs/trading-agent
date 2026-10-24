import { q, tryq } from "@/lib/db";
import { handle } from "@/lib/http";
export const dynamic = "force-dynamic";
export function GET() {
  return handle(async () => {
    const [sources, lessons, calibration, outcomes] = await Promise.all([
      q(`select so.id,so.url,so.weight,(select count(*) from signals s where s.source_id=so.id)::int signals from sources so order by weight desc, url limit 100`),
      q("select id,text,origin,created_at from lessons order by created_at desc limit 50"),
      tryq("select * from calibration order by 1 desc limit 30"),
      tryq("select * from learning_events order by 1 desc limit 30"),
    ]);
    return { sources, lessons, calibration: calibration.error ? null : calibration.rows, learningEvents: outcomes.error ? null : outcomes.rows };
  });
}
