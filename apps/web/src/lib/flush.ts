import "server-only";
import { prisma } from "@/lib/db";
import { getAdapter, getEnabledAdapters } from "@/lib/channels/registry";
import { MetaApiError } from "@/lib/channels/whatsapp-cloud";
import type { ChannelMessage } from "@/lib/channels/types";
import { decideAction } from "@/lib/ai-rules";
import { checkCostBudget, recordUsage } from "@/lib/guardrails";
import { generateReply, type ChatTurn } from "@/lib/llm";
import { getSettings, appUrl } from "@/lib/settings";
import { logError, logEvent } from "@/lib/log";
import { pushDlq } from "@/lib/redis";
import { lessonsForPrompt } from "@/lib/lessons";
import { getRoutes, routingInstructions, IGNORE_TAG, ROUTE_DEFAULTS, ROUTE_TAG, type HandoffRoute } from "@/lib/handoff-routes";

const POLITE_ERROR = "Opa, tive um probleminha aqui pra responder agora. Tenta de novo em instantes? 🙏";
const BUDGET_REPLY = "Recebi tua mensagem! Um atendente vai te responder em breve. 🙌";

/**
 * Resolve o ID EXTERNO do contato (wa_id). Nunca usar conv.contactId,
 * que é o cuid interno de Contact (§0.9.27).
 */
export async function resolveExternalId(conversationId: string): Promise<string | null> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) return null;
  const ident = await prisma.contactIdentity.findFirst({
    where: { contactId: conv.contactId, channel: conv.channel },
  });
  return ident?.externalId ?? null;
}

/** Envia pelo canal e grava a msg outbound. */
export async function sendAndPersist(
  conversationId: string,
  channel: string,
  externalId: string,
  text: string,
  extra: { role?: "assistant" | "operator" | "system"; tokensIn?: number; tokensOut?: number; costUsd?: number; modelUsed?: string } = {},
) {
  logEvent("flush.sending", { conversationId, chars: text.length });
  const { providerMsgId } = await getAdapter(channel).sendText(externalId, text);
  await prisma.message.create({
    data: {
      conversationId,
      direction: "outbound",
      role: extra.role ?? "assistant",
      text,
      providerMsgId,
      tokensIn: extra.tokensIn,
      tokensOut: extra.tokensOut,
      costUsd: extra.costUsd,
      modelUsed: extra.modelUsed,
    },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  logEvent("flush.sent_ok", { conversationId, providerMsgId });
}

function fillPlaceholders(prompt: string, s: { deliveryUrl: string; businessName: string }) {
  return prompt
    .replaceAll("{{LINK}}", s.deliveryUrl || "(link ainda não configurado)")
    .replaceAll("{{DELIVERY_URL}}", s.deliveryUrl || "(link ainda não configurado)")
    .replaceAll("{{BUSINESS_NAME}}", s.businessName);
}

/** Últimas N msgs como turns alternados user/assistant, começando por user. */
async function buildHistory(conversationId: string, memoryMode: string): Promise<ChatTurn[]> {
  if (memoryMode === "stateless") {
    const last = await prisma.message.findMany({
      where: { conversationId, direction: "inbound" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return [{ role: "user", content: last.reverse().map((m) => m.text).join("\n") }];
  }
  const n = Number(memoryMode.match(/\d+/)?.[0] ?? 20);
  const rows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant", "operator"] } },
    orderBy: { createdAt: "desc" },
    take: n,
  });
  const turns: ChatTurn[] = [];
  for (const m of rows.reverse()) {
    const role = m.role === "user" ? "user" : "assistant";
    const prev = turns.at(-1);
    if (prev?.role === role) prev.content += `\n${m.text}`;
    else turns.push({ role, content: m.text });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

/**
 * Encaminha a conversa para uma rota (atendimento, orçamento…): pausa a IA,
 * responde o cliente e avisa o número da rota com o que o cliente escreveu.
 */
async function doHandoff(
  conversationId: string,
  channel: string,
  externalId: string,
  route: HandoffRoute,
  reason: string,
  msgs: ChannelMessage[],
) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { aiEnabled: false, handoffRequested: true, handoffRoute: route.key },
  });
  logEvent("handoff.requested", { conversationId, route: route.key, reason });
  await sendAndPersist(conversationId, channel, externalId, route.reply, { role: "system" });

  if (!route.phone) return;
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  const said = msgs.map((m) => m.text).join("\n").slice(0, 500);
  const note =
    `🔔 ${route.label}\n` +
    `${conv?.contact.displayName ?? "Cliente"} (+${externalId.replace(/@.*/, "")})\n` +
    (said ? `Mensagem: "${said}"\n` : "") +
    `${appUrl()}/conversations/${conversationId}`;
  // Tenta o canal da conversa e depois os outros. O Waha não tem janela de 24h,
  // então cobre o caso 131047 da Cloud API (destino sem conversa aberta).
  const order = [getAdapter(channel), ...getEnabledAdapters().filter((a) => a.id !== channel)];
  for (const adapter of order) {
    try {
      await adapter.sendText(route.phone, note);
      logEvent("handoff.notified", { conversationId, route: route.key, via: adapter.id });
      return;
    } catch (err) {
      logError("handoff.notify_failed", err, {
        conversationId,
        route: route.key,
        via: adapter.id,
        code: err instanceof MetaApiError ? err.code : undefined,
      });
    }
  }
  // Nenhum canal conseguiu: o painel ainda mostra o badge de encaminhamento pendente.
}

async function agentRoutes(conv: { agentSessionId: string | null }) {
  const id = conv.agentSessionId ?? (await prisma.agentSession.findFirst({ where: { isDefault: true } }))?.id;
  return id ? getRoutes(id) : [];
}

export async function flushConversation(conversationId: string, msgs: ChannelMessage[]) {
  logEvent("flush.start", { conversationId, msgs: msgs.length });
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conv) return;

  const externalId = msgs[0]?.externalId ?? (await resolveExternalId(conversationId));
  if (!externalId) {
    logError("flush.no_external_id", "missing", { conversationId });
    return;
  }

  const last = msgs.at(-1)?.providerMsgId;
  if (last) getAdapter(conv.channel).markRead?.(last, externalId).catch(() => {});

  const decision = await decideAction(msgs, conv);
  logEvent("flush.decided", {
    conversationId,
    action: decision.action,
    reason: "reason" in decision ? decision.reason : undefined,
    ruleId: "ruleId" in decision ? decision.ruleId : undefined,
  });

  try {
    if (decision.action === "drop") return;
    if (decision.action === "handoff") {
      const routes = await agentRoutes(conv);
      const route =
        routes.find((r) => r.ruleId === decision.ruleId) ??
        ({ ...ROUTE_DEFAULTS.atendimento, phone: (await getSettings()).handoffPhone } satisfies HandoffRoute);
      await doHandoff(conversationId, conv.channel, externalId, route, decision.reason, msgs);
      return;
    }
    if (decision.action === "static_reply") {
      if (decision.text) await sendAndPersist(conversationId, conv.channel, externalId, decision.text, { role: "system" });
      return;
    }

    const budget = await checkCostBudget(conv.contactId);
    if (budget !== "ok") {
      logEvent("guardrail.budget_exceeded", { conversationId, budget });
      await sendAndPersist(conversationId, conv.channel, externalId, BUDGET_REPLY, { role: "system" });
      return;
    }

    const agent = decision.agentSession;
    const settings = await getSettings();
    const routes = await getRoutes(agent.id);
    const knowledge = await lessonsForPrompt(msgs.map((m) => m.text).join("\n"));
    const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const system =
      `${fillPlaceholders(agent.systemPrompt, settings)}${knowledge}${routingInstructions(routes)}` +
      `\n\n[Contexto] Agora: ${now} (horário de Brasília). Cliente: ${conv.contact.displayName ?? "não informado"}.`;
    const history = await buildHistory(conversationId, agent.memoryMode);

    let reply;
    try {
      reply = await generateReply(agent, system, history, { conversationId });
    } catch (err) {
      logError("flush.llm_all_failed", err, { conversationId });
      await pushDlq({ conversationId, err: String(err) });
      await sendAndPersist(conversationId, conv.channel, externalId, POLITE_ERROR, { role: "system" });
      return;
    }
    await recordUsage(conv.contactId, reply.tokensIn, reply.tokensOut, reply.costUsd);

    // Não é cliente (conversa pessoal, família, outro assunto…): IA fica calada
    if (IGNORE_TAG.test(reply.text)) {
      logEvent("flush.ignored_not_customer", { conversationId, provider: reply.provider });
      return;
    }

    // O atendente pode ter escrito enquanto a IA pensava: não atropela a pessoa
    const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!fresh?.aiEnabled || (fresh.aiPausedUntil && fresh.aiPausedUntil > new Date())) {
      logEvent("flush.dropped_human_took_over", { conversationId });
      return;
    }

    // A IA pediu encaminhamento (cliente pediu orçamento sem usar a palavra-chave etc.)
    const tag = reply.text.match(ROUTE_TAG);
    const tagged = tag && routes.find((r) => r.key === tag[1].toLowerCase());
    if (tagged) {
      await doHandoff(conversationId, conv.channel, externalId, tagged, `llm:${reply.provider}`, msgs);
      return;
    }
    if (tag) reply.text = reply.text.replace(ROUTE_TAG, "").trim() || POLITE_ERROR; // rota desconhecida

    await sendAndPersist(conversationId, conv.channel, externalId, reply.text, {
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      costUsd: reply.costUsd,
      modelUsed: `${reply.provider}/${reply.model}`,
    });
  } catch (err) {
    logError("flush.send_failed", err, {
      conversationId,
      code: err instanceof MetaApiError ? err.code : undefined,
    });
    await pushDlq({ conversationId, err: String(err) });
  }
}
