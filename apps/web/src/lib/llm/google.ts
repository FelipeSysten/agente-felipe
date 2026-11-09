import "server-only";
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";
import type { LLMProvider } from "./types";

let ai: GoogleGenAI | undefined;
// Timeout curto: sob alta demanda o Gemini pode levar >1min; melhor cair p/ o Groq.
const client = () =>
  (ai ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY, httpOptions: { timeout: 15_000 } }));

// Gemini 3 usa thinkingLevel; 2.5 usa thinkingBudget. Alias "*-latest": deixa o default.
function thinkingFor(model: string): ThinkingConfig | undefined {
  if (model.includes("gemini-3")) return { thinkingLevel: ThinkingLevel.LOW };
  if (model.includes("2.5-flash")) return { thinkingBudget: 0 };
  return undefined;
}

export const googleProvider: LLMProvider = {
  id: "google",
  available: () => Boolean(process.env.GOOGLE_API_KEY),
  defaultModel: () => process.env.GEMINI_MODEL ?? "gemini-2.5-flash",

  async chat({ system, messages, model, temperature, maxTokens }) {
    const res = await client().models.generateContent({
      model,
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction: system,
        temperature,
        // tokens de raciocínio contam no limite: folga p/ não vir resposta vazia
        maxOutputTokens: Math.max(maxTokens * 4, 2048),
        thinkingConfig: thinkingFor(model),
      },
    });
    const text = res.text?.trim() ?? "";
    if (!text) throw new Error(`gemini: resposta vazia (finish=${res.candidates?.[0]?.finishReason})`);
    return {
      text,
      tokensIn: res.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};
