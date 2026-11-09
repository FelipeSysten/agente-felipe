import "server-only";
import { logError, logEvent } from "@/lib/log";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { groqProvider } from "./groq";
import type { ChatTurn, LLMProvider, ProviderId } from "./types";

export type { ChatTurn, ProviderId } from "./types";

// Ordem da cadeia: grátis primeiro, Anthropic (pago) por último.
const CHAIN: LLMProvider[] = [googleProvider, groqProvider, anthropicProvider];

// USD por 1M tokens (input, output). Free tiers = 0.
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};

export function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const [pin, pout] = PRICES[model] ?? [0, 0];
  return (tokensIn * pin + tokensOut * pout) / 1_000_000;
}

export function providerOptions() {
  return CHAIN.map((p) => ({ id: p.id, available: p.available(), defaultModel: p.defaultModel() }));
}

interface AgentLike {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/**
 * Tenta o provedor do agente; se falhar (erro, 429, cota), cai para os
 * demais na ordem da cadeia, cada um com seu modelo padrão.
 */
export async function generateReply(
  agent: AgentLike,
  system: string,
  messages: ChatTurn[],
  ctx: Record<string, unknown>,
) {
  const primary = CHAIN.find((p) => p.id === agent.provider);
  const order = [
    ...(primary ? [{ p: primary, model: agent.model }] : []),
    ...CHAIN.filter((p) => p !== primary).map((p) => ({ p, model: p.defaultModel() })),
  ].filter(({ p }) => p.available());

  if (order.length === 0) throw new Error("nenhum provedor de IA configurado");

  let lastErr: unknown;
  for (const { p, model } of order) {
    const started = Date.now();
    try {
      logEvent("llm.call", { ...ctx, provider: p.id, model });
      const r = await p.chat({
        system,
        messages,
        model,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
      const costUsd = computeCost(model, r.tokensIn, r.tokensOut);
      logEvent("llm.response", {
        ...ctx,
        provider: p.id,
        model,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        costUsd,
        latencyMs: Date.now() - started,
      });
      return { ...r, provider: p.id as ProviderId, model, costUsd };
    } catch (err) {
      lastErr = err;
      logError("llm.failed", err, { ...ctx, provider: p.id, model, latencyMs: Date.now() - started });
    }
  }
  throw lastErr;
}
