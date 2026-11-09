import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ChannelMessage } from "@/lib/channels/types";

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// create + catch P2002 em vez de upsert: upsert não é atômico sob concorrência (§0.9.5)
async function ensureContactIdentity(channel: string, externalId: string, displayName?: string) {
  try {
    return await prisma.contactIdentity.create({
      data: { channel, externalId, contact: { create: { displayName: displayName ?? externalId } } },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.contactIdentity.findUniqueOrThrow({
      where: { channel_externalId: { channel, externalId } },
    });
  }
}

/** Uma conversa por cliente, canal e número do bot (`line`): número novo, conversa nova. */
async function ensureConversation(contactId: string, channel: string, line: string) {
  const existing = await prisma.conversation.findUnique({
    where: { contactId_channel_line: { contactId, channel, line } },
  });
  if (existing) return existing;
  const agent = await prisma.agentSession.findFirst({ where: { isDefault: true } });
  try {
    return await prisma.conversation.create({
      data: { contactId, channel, line, agentSessionId: agent?.id },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.conversation.findUniqueOrThrow({
      where: { contactId_channel_line: { contactId, channel, line } },
    });
  }
}

/**
 * Msg que o atendente mandou direto pelo celular/WhatsApp Web do número do bot:
 * grava como "operator" (aparece no painel) e pausa a IA nesta conversa por
 * `pauseSeconds`. Cada nova msg do atendente renova a pausa. Null = duplicata.
 */
export async function persistOperatorMessage(msg: ChannelMessage, pauseSeconds: number) {
  const dup = await prisma.message.findUnique({ where: { providerMsgId: msg.providerMsgId } });
  if (dup) return null;

  const identity = await ensureContactIdentity(msg.channel, msg.externalId);
  const conversation = await ensureConversation(identity.contactId, msg.channel, msg.line ?? "");
  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "outbound",
        role: "operator",
        text: msg.text,
        providerMsgId: msg.providerMsgId,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  const now = Date.now();
  const aiPausedUntil = new Date(now + pauseSeconds * 1000);
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(now), aiPausedUntil },
  });
  return { conversation, aiPausedUntil };
}

/**
 * Persiste a msg do cliente. Retorna null se for duplicata (Meta reenvia
 * webhooks que não receberam 200 a tempo).
 */
export async function persistInbound(msg: ChannelMessage) {
  const dup = await prisma.message.findUnique({ where: { providerMsgId: msg.providerMsgId } });
  if (dup) return null;

  const identity = await ensureContactIdentity(msg.channel, msg.externalId, msg.contactName);
  const conversation = await ensureConversation(identity.contactId, msg.channel, msg.line ?? "");

  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "inbound",
        role: "user",
        text: msg.text,
        providerMsgId: msg.providerMsgId,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null; // corrida entre 2 entregas do mesmo evento
    throw err;
  }

  const now = new Date();
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now, lastInboundAt: now },
  });
  return { conversation, contactId: identity.contactId };
}
