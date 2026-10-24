export const COOKIE = "dash_auth";
export async function token(pw: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dash:" + pw));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
