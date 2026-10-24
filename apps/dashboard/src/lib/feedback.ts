import { UUID } from "./http";
export const ANSWERS = ["Good call", "Bad call", "Too risky"] as const;
export function validateFeedback(b: any): { thesisId: string; answer: string } | string {
  if (!b || typeof b !== "object") return "invalid body";
  if (typeof b.thesisId !== "string" || !UUID.test(b.thesisId)) return "invalid thesisId";
  if (typeof b.answer !== "string" || !(ANSWERS as readonly string[]).includes(b.answer)) return "answer must be Good call, Bad call or Too risky";
  return { thesisId: b.thesisId.toLowerCase(), answer: b.answer };
}
