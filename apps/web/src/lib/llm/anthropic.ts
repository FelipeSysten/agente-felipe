import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./types";

let anthropic: Anthropic | undefined;
const client = () =>
  (anthropic ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 1,
    timeout: 30_000,
    // Chaves sem workspace exigem o header explícito.
    ...(process.env.ANTHROPIC_WORKSPACE_ID && {
      defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID },
    }),
  }));

// Último elo da cadeia (pago). Haiku 5.5: thinking adaptativo sempre ligado,
// effort "low" p/ chat curto de WhatsApp; max_tokens inclui o raciocínio.
export const anthropicProvider: LLMProvider = {
  id: "anthropic",
  available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  defaultModel: () => process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",

  async chat({ system, messages, model, maxTokens }) {
    const res = await client().messages.create({
      model,
      max_tokens: Math.max(maxTokens * 4, 4096),
      output_config: { effort: "low" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    });
    if (res.stop_reason === "refusal") throw new Error("anthropic: refusal");
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new Error(`anthropic: resposta vazia (stop=${res.stop_reason})`);
    return {
      text,
      tokensIn:
        res.usage.input_tokens +
        (res.usage.cache_read_input_tokens ?? 0) +
        (res.usage.cache_creation_input_tokens ?? 0),
      tokensOut: res.usage.output_tokens,
    };
  },
};
