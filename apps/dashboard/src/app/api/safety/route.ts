import { q } from "@/lib/db";
import { HttpError, body, handle } from "@/lib/http";
import { mergePrefs, readPrefs } from "@/lib/prefs";
export const dynamic = "force-dynamic";
export function GET() {
  return handle(async () => {
    const [prefs, events] = await Promise.all([
      readPrefs(),
      q(`select g.id,g.verdict,g.reasons,g.created_at,g.thesis_id,t.asset from guardrail_events g left join theses t on t.id=g.thesis_id order by g.created_at desc limit 100`),
    ]);
    return { killSwitch: !!prefs.killSwitch, events };
  });
}
export function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (typeof b.killSwitch !== "boolean") throw new HttpError(400, "killSwitch must be boolean");
    await mergePrefs({ killSwitch: b.killSwitch });
    return { ok: true, killSwitch: b.killSwitch };
  });
}
