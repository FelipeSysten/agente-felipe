import "server-only";
import Groq from "groq-sdk";
import type { LLMProvider } from "./types";

let groq: Groq | undefined;
const client = () => (groq ??= new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 1, timeout: 15_000 }));

export const groqProvider: LLMProvider = {
  id: "groq",
  available: () => Boolean(process.env.GROQ_API_KEY),
  defaultModel: () => process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",

  async chat({ system, messages, model, temperature, maxTokens }) {
    // gpt-oss raciocina antes de responder: esforço baixo e folga no limite,
    // com o raciocínio fora do `content`.
    const reasoning = model.startsWith("openai/gpt-oss");
    const res = await client().chat.completions.create({
      model,
      temperature,
      max_completion_tokens: reasoning ? Math.max(maxTokens * 4, 2048) : maxTokens,
      ...(reasoning && { reasoning_effort: "low" as const, include_reasoning: false }),
      messages: [{ role: "system", content: system }, ...messages],
    });
    const text = res.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("groq: resposta vazia");
    return {
      text,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
    };
  },
};
