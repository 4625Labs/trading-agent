import { NextResponse } from "next/server";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
export async function handle(fn: () => Promise<unknown>) {
  try { return NextResponse.json(await fn(), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) {
    const status = (e as any)?.status ?? 500;
    return NextResponse.json({ error: status === 500 ? "server error" : (e as Error).message }, { status });
  }
}
export class HttpError extends Error { constructor(public status: number, m: string) { super(m); } }
export async function body(req: Request): Promise<any> {
  try { const b = await req.json(); if (b && typeof b === "object") return b; } catch { /* fallthrough */ }
  throw new HttpError(400, "invalid JSON body");
}
