import { body, handle } from "@/lib/http";
import { mergePrefs, readPrefs, validatePrefs } from "@/lib/prefs";
export const dynamic = "force-dynamic";
export function GET() { return handle(async () => { const { killSwitch, ...p } = await readPrefs(); return p; }); }
export function POST(req: Request) {
  return handle(async () => {
    const p = validatePrefs(await body(req));
    await mergePrefs(p);
    return { ok: true, prefs: p };
  });
}
