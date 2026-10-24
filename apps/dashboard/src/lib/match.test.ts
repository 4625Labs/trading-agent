import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, findInteraction, optionIndex, type Interaction } from "./match.ts";

const T1 = "11111111-2222-3333-4444-555555555555";
const T2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const mk = (id: string, prompt: string, labels: string[], state = "open", kind = "question"): Interaction => ({
  id, interaction_kind: kind, state, request: { questions: [{ prompt, options: labels.map((label) => ({ label })) }] },
});
const list = [
  mk("i1", `Approve BTC long? thesis ${T1}`, ["Reject", "Approve"]),
  mk("i2", `Feedback on thesis ${T1}?`, ["Good call", "Bad call", "Too risky"]),
  mk("i3", `Approve ETH short? thesis ${T2}`, ["Approve", "Reject"], "resolved"),
  mk("i4", `thesis ${T2}`, ["Approve"], "open", "permission"),
];

test("classify", () => {
  assert.deepEqual(classify(list[0]), { kind: "approval", thesisId: T1 });
  assert.deepEqual(classify(list[1]), { kind: "feedback", thesisId: T1 });
  assert.equal(classify(list[3]).kind, "other");
  assert.equal(classify(mk("x", "no id here", ["a"])).kind, "other");
});
test("findInteraction separates approval and feedback, ignores resolved", () => {
  assert.equal(findInteraction(list, T1, "approval")?.id, "i1");
  assert.equal(findInteraction(list, T1, "feedback")?.id, "i2");
  assert.equal(findInteraction(list, T2, "approval"), undefined);
  assert.equal(findInteraction(list, T1.toUpperCase(), "approval")?.id, "i1");
});
test("optionIndex", () => {
  assert.equal(optionIndex(list[0], "approve"), 1);
  assert.equal(optionIndex(list[0], "reject"), 0);
  assert.equal(optionIndex(list[1], "Too risky"), 2);
  assert.equal(optionIndex(list[1], "nope"), -1);
});
