import "server-only";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export type RouteKey = "atendimento" | "reservas";

/** Rota de encaminhamento: palavra-chave (ou a IA) → avisa um número e pausa a IA. */
export interface HandoffRoute {
  key: RouteKey;
  label: string;
  /** Descrição da intenção, usada no prompt p/ a IA acionar a rota sem palavra-chave. */
  intent: string;
  keywords: string[];
  /** Só dígitos com DDI (ex: 5573999091977). Vazio = só marca no painel. */
  phone: string;
  /** Mensagem enviada ao cliente ao encaminhar. */
  reply: string;
  ruleId?: string;
}

type RouteParams = Partial<Omit<HandoffRoute, "ruleId">> & { route?: RouteKey };

export const ROUTE_DEFAULTS: Record<RouteKey, Omit<HandoffRoute, "phone" | "reply"> & { reply: string }> = {
  atendimento: {
    key: "atendimento",
    label: "Atendimento",
    intent:
      "PEDIR EXPLICITAMENTE para falar com um atendente/uma pessoa da equipe, ou reclamar de um problema com um pedido ou entrega já feito",
    keywords: ["atendente", "humano", "falar com alguem", "falar com uma pessoa", "reclamacao", "gerente"],
    reply: "Certo! Vou chamar um atendente pra falar contigo. Já já alguém te responde por aqui. 🙌",
  },
  reservas: {
    key: "reservas",
    label: "Reservas de mesa",
    intent: "reservar ou agendar uma mesa no restaurante (data, horário, quantidade de pessoas)",
    keywords: ["reserva", "reservar", "agendar mesa", "agendamento de mesa", "reservar mesa", "guardar uma mesa"],
    reply:
      "Que bom! As reservas de mesa são feitas direto com a nossa equipe. Já passei teu pedido pra eles e logo te chamam no WhatsApp (73) 99909-1977 pra confirmar. 🍽️",
  },
};

/** Rotas do agente: regras keyword_pause→handoff; a sem `route` é a de atendimento (legado). */
export async function getRoutes(agentSessionId: string): Promise<HandoffRoute[]> {
  const [rules, settings] = await Promise.all([
    prisma.aIRule.findMany({
      where: { agentSessionId, enabled: true, mode: "keyword_pause", action: "handoff" },
      orderBy: { priority: "asc" },
    }),
    getSettings(),
  ]);
  return rules.map((rule) => {
    const p = (rule.params ?? {}) as RouteParams;
    const key: RouteKey = p.route ?? "atendimento";
    const d = ROUTE_DEFAULTS[key];
    return {
      key,
      label: p.label ?? d.label,
      intent: p.intent ?? d.intent,
      keywords: p.keywords ?? d.keywords,
      // Atendimento mantém telefone/resposta em AppSettings (editáveis em Configurações)
      phone: (key === "atendimento" ? settings.handoffPhone : p.phone) ?? "",
      reply: (key === "atendimento" ? settings.handoffReply : p.reply) || d.reply,
      ruleId: rule.id,
    };
  });
}

import { canonicalPhone } from "@/lib/phone";
export { canonicalPhone };

/** Telefones da equipe (todas as rotas), canônicos: mensagens deles nunca vão para a IA. */
export async function staffPhones(): Promise<Set<string>> {
  const [rules, settings] = await Promise.all([
    prisma.aIRule.findMany({ where: { mode: "keyword_pause", action: "handoff" } }),
    getSettings(),
  ]);
  const phones = rules.map((r) => (r.params as RouteParams | null)?.phone ?? "");
  return new Set([settings.handoffPhone, ...phones].filter(Boolean).map(canonicalPhone));
}

/**
 * Regras do sistema anexadas ao prompt (o texto editável no painel fica intacto):
 * - fatos: nada de inventar horário/preço/taxa — só o que está escrito;
 * - encaminhamento e silêncio: a IA aciona uma rota ou fica calada respondendo só
 *   com a tag. O número também recebe conversas pessoais e de outros negócios do
 *   dono — nessas a IA não deve se meter.
 */
export function routingInstructions(routes: HandoffRoute[]): string {
  const lines = routes.map((r) => `- Se o cliente quiser ${r.intent}: responda APENAS com [[ENCAMINHAR:${r.key}]]`);
  return `\n\n[Regras do sistema — fatos]
- Horários, preços, taxas e áreas de entrega, formas de pagamento, sabores/produtos disponíveis, promoções, endereço e prazos: use SOMENTE o que estiver escrito acima (prompt ou conhecimento validado).
- Se a informação não estiver escrita acima, NÃO confirme nem negue — nada de "sim, temos", "aceitamos", "não fazemos" ou valores "aproximados". Diga que essa informação está no link do pedido (cardápio, preços, pagamento) ou ofereça chamar um atendente.
  Exemplos (quando NÃO há essa informação acima):
  • "aceita cartão?" → "As formas de pagamento aparecem no link, na hora de finalizar o pedido: <link>"
  • "tem pizza de chocolate?" → "Todos os sabores disponíveis estão no cardápio: <link>"

[Regras do sistema — encaminhamento e silêncio]
${lines.join("\n")}
- Se a mensagem claramente NÃO for de um cliente do restaurante — conversa pessoal, recado ou pergunta para alguém pelo nome (ex: "Felipe, …", "Fulano já saiu?"), assunto de outro negócio, pix/pagamento que não seja de pedido do restaurante, ou mensagem automática de outra empresa —: responda APENAS com [[IGNORAR]]. O dono do número responde pessoalmente.
- Cumprimentos ("oi", "boa noite"), dúvidas sobre cardápio, preços, entrega, horário ou pedidos são de cliente: responda normalmente.
- Mencionar o nome de alguém ou fazer uma pergunta NÃO é pedir atendente. Na dúvida, responda normalmente como atendente do restaurante, sem tag.
- Nunca escreva mais nada junto de uma tag.`;
}

export const ROUTE_TAG = /\[\[ENCAMINHAR:([a-z]+)\]\]/i;
export const IGNORE_TAG = /\[\[IGNORAR\]\]/i;
