/** Injectable LLM function: returns the model's raw text. Uses global fetch against the Anthropic Messages API (no SDK). */
export interface LlmRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}
export type LlmFn = (req: LlmRequest) => Promise<string>;

export const MODEL_EXTRACT = "claude-haiku-5-5";
export const MODEL_THESIS = "claude-sonnet-5-5";

export function anthropicLlm(apiKey = process.env.ANTHROPIC_API_KEY): LlmFn {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return async ({ model, system, prompt, maxTokens }) => {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens ?? 2000, system, messages: [{ role: "user", content: prompt }] }),
      });
    } catch (e) {
      throw new Error(`anthropic request failed: ${(e as Error).name}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${text.replace(apiKey, "<key>").slice(0, 200)}`);
    const j = JSON.parse(text);
    return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  };
}

/** Pull the first JSON value out of model text (tolerates code fences / prose). */
export function parseJsonLoose(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in model output");
  const open = t[start], close = open === "{" ? "}" : "]";
  const end = t.lastIndexOf(close);
  if (end <= start) throw new Error("unterminated JSON in model output");
  return JSON.parse(t.slice(start, end + 1));
}
