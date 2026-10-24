// Pure helpers for matching Omnara interactions to theses. No I/O so they are unit-testable.
export interface Interaction {
  id: string;
  interaction_kind?: string;
  state?: string;
  request?: { questions?: { prompt?: string; options?: { label: string }[] }[] };
  [k: string]: unknown;
}
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const FEEDBACK_LABELS = ["Good call", "Bad call", "Too risky"] as const;
export type Kind = "approval" | "feedback";

export const promptOf = (it: Interaction): string => it.request?.questions?.[0]?.prompt ?? "";
export const labelsOf = (it: Interaction): string[] => (it.request?.questions?.[0]?.options ?? []).map((o) => o.label);

export function classify(it: Interaction): { kind: Kind | "other"; thesisId?: string } {
  if (it.interaction_kind && it.interaction_kind !== "question") return { kind: "other" };
  const p = promptOf(it);
  const id = UUID_RE.exec(p)?.[0]?.toLowerCase();
  if (!id) return { kind: "other" };
  if (/^\s*feedback/i.test(p)) return { kind: "feedback", thesisId: id };
  return { kind: "approval", thesisId: id };
}

export function findInteraction(list: Interaction[], thesisId: string, kind: Kind): Interaction | undefined {
  const t = thesisId.toLowerCase();
  return list.find((it) => {
    const c = classify(it);
    return c.kind === kind && c.thesisId === t && (it.state === undefined || it.state === "open");
  });
}

/** Index of the option matching the choice: approve/reject by prefix, feedback by exact (case-insensitive) label. */
export function optionIndex(it: Interaction, choice: string): number {
  const labels = labelsOf(it);
  const c = choice.toLowerCase();
  const re = c === "approve" ? /^approve/i : c === "reject" ? /^reject/i : null;
  return labels.findIndex((l) => (re ? re.test(l) : l.toLowerCase() === c));
}
