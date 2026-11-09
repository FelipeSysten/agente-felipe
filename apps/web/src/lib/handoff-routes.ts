import "server-only";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export type RouteKey = "atendimento" | "orcamento";

/** Rota de encaminhamento: palavra-chave (ou a IA) → avisa um número e pausa a IA. */
export interface HandoffRoute {
  key: RouteKey;
  label: string;
  /** Descrição da intenção, usada no prompt p/ a IA acionar a rota sem palavra-chave. */
  intent: string;
  keywords: string[];
  /** Só dígitos com DDI (ex: 5573999999999). Vazio = só marca no painel. */
  phone: string;
  /** Mensagem enviada ao cliente ao encaminhar. */
  reply: string;
  ruleId?: string;
}

type RouteParams = Partial<Omit<HandoffRoute, "ruleId">> & { route?: RouteKey };

export const ROUTE_DEFAULTS: Record<RouteKey, Omit<HandoffRoute, "phone" | "reply"> & { reply: string }> = {
  atendimento: {
    key: "atendimento",
    label: "Falar com o Felipe",
    intent:
      "PEDIR EXPLICITAMENTE para falar com o Felipe/uma pessoa, relatar um problema urgente (sistema fora do ar, computador parado, site caído) ou reclamar de um serviço já feito",
    keywords: ["atendente", "humano", "falar com o felipe", "falar com felipe", "falar com uma pessoa", "reclamacao"],
    reply: "Certo! Já avisei o Felipe e ele te responde por aqui assim que possível. 🙌",
  },
  orcamento: {
    key: "orcamento",
    label: "Orçamento",
    intent:
      "pedir orçamento, valor, proposta ou fechar um projeto DEPOIS de já ter dito qual serviço quer (design, site/sistema/app, automação ou suporte de TI)",
    keywords: ["fechar projeto", "fechar o projeto", "proposta comercial"],
    reply:
      "Perfeito! Anotei o que você precisa e passei pro Felipe. Ele vai analisar e te manda o orçamento por aqui. 🚀",
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
 * - fatos: nada de inventar preço/prazo/portfólio — só o que está escrito;
 * - encaminhamento e silêncio: a IA aciona uma rota ou fica calada respondendo só
 *   com a tag. Este é o WhatsApp PESSOAL do Felipe — amigos, família e conversas
 *   que não são de cliente ficam sem resposta da IA.
 */
export function routingInstructions(routes: HandoffRoute[]): string {
  const lines = routes.map((r) => `- Se a pessoa quiser ${r.intent}: responda APENAS com [[ENCAMINHAR:${r.key}]]`);
  return `\n\n[Regras do sistema — fatos]
- Preços, prazos, formas de pagamento, tecnologias, trabalhos já feitos, clientes atendidos e disponibilidade de agenda: use SOMENTE o que estiver escrito acima (prompt ou conhecimento validado).
- Se a informação não estiver escrita acima, NÃO confirme nem negue — nada de "sim, faço", "custa uns R$…", "fica pronto em X dias". Diga que o Felipe avalia cada projeto e envia o orçamento, ou mande o link do portfólio.
  Exemplos (quando NÃO há essa informação acima):
  • "quanto custa um site?" → pergunte o que o site precisa ter (páginas, objetivo, prazo); o valor quem passa é o Felipe.
  • "você já fez app de delivery?" → "Os trabalhos do Felipe estão no portfólio: <link>"

[Regras do sistema — encaminhamento e silêncio]
${lines.join("\n")}
- Este é o WhatsApp PESSOAL do Felipe. Responda apenas quem claramente quer contratar ou tirar dúvida sobre design, desenvolvimento (sites, sistemas, apps, automações) ou TI.
- Se a mensagem NÃO for de um cliente ou interessado nos serviços — família, amigos, conversa pessoal, combinados do dia a dia, memes/figurinhas, pix ou cobrança pessoal, mensagem automática de empresa, ou se o histórico acima mostra que é uma conversa pessoal —: responda APENAS com [[IGNORAR]]. O Felipe responde pessoalmente.
- "Oi"/"boa tarde" de quem não tem histórico pessoal acima: cumprimente e pergunte em que pode ajudar. Perguntas sobre serviços, portfólio, orçamento ou suporte técnico são de cliente: responda normalmente.
- Chamar o Felipe pelo nome ("Oi Felipe, preciso de um site") NÃO é pedir atendente: responda normalmente como assistente dele.
- Na dúvida entre cliente e conversa pessoal, prefira [[IGNORAR]].
- Nunca escreva mais nada junto de uma tag.`;
}

export const ROUTE_TAG = /\[\[ENCAMINHAR:([a-z]+)\]\]/i;
export const IGNORE_TAG = /\[\[IGNORAR\]\]/i;
