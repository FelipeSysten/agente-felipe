import "server-only";
import { after } from "next/server";
import type { ChannelMessage } from "@/lib/channels/types";
import { persistInbound, persistOperatorMessage } from "@/lib/inbound";
import { debounceAndFlush } from "@/lib/debounce";
import { checkRateLimit } from "@/lib/redis";
import { getSettings } from "@/lib/settings";
import { canonicalPhone, staffPhones } from "@/lib/handoff-routes";
import { logError, logEvent } from "@/lib/log";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/channels/registry";
import { transcribeAudio } from "@/lib/transcribe";
import { captureFromOperator } from "@/lib/lessons";

/**
 * Entrada comum a todos os canais (o HMAC já foi validado pela rota):
 * filtra o atendente, aplica rate limit, persiste e agenda o debounce.
 */
export async function intake(msgs: ChannelMessage[]) {
  if (!msgs.length) return;
  const [settings, staff] = await Promise.all([getSettings(), staffPhones()]);

  for (const msg of msgs) {
    logEvent("webhook.received", { channel: msg.channel, providerMsgId: msg.providerMsgId, operator: msg.fromOperator });
    // Sem o número do bot no payload (gateway antigo): assume o conectado agora
    if (!msg.line && msg.channel === "waha" && settings.wahaLine) msg.line = settings.wahaLine;

    if (msg.fromOperator) {
      // Atendente humano respondeu pelo celular: registra no painel e pausa a IA
      const saved = await persistOperatorMessage(msg, settings.humanPauseSeconds);
      if (saved) {
        logEvent("operator.message", {
          conversationId: saved.conversation.id,
          aiPausedUntil: saved.aiPausedUntil.toISOString(),
        });
        // Resposta humana a uma pergunta de cliente → lição sugerida (aprovação no painel)
        await captureFromOperator(saved.conversation.id, msg.text).catch((err) =>
          logError("lesson.capture_failed", err, { conversationId: saved.conversation.id }),
        );
      }
      continue;
    }

    if (staff.has(canonicalPhone(msg.externalId))) {
      // Msg da própria equipe (atendente, reservas) p/ o número do bot: nunca vai p/ a IA.
      logEvent("webhook.from_staff_phone", { channel: msg.channel });
      continue;
    }
    if (!(await checkRateLimit(`${msg.channel}:${msg.externalId}`))) {
      logEvent("webhook.rate_limited", { channel: msg.channel });
      continue;
    }

    const saved = await persistInbound(msg);
    if (!saved) {
      logEvent("webhook.duplicate", { providerMsgId: msg.providerMsgId });
      continue;
    }
    after(async () => {
      if (msg.audio) await transcribeInto(msg, saved.conversation.id);
      await debounceAndFlush(saved.conversation.id, msg, settings.debounceWindowMs);
    });
  }
}

/**
 * Nota de voz → texto. Atualiza a msg gravada (histórico da IA e painel) e o
 * próprio `msg` (regras de palavra-chave). Falhou → avisa a IA que não entendeu.
 */
export async function transcribeInto(msg: ChannelMessage, conversationId: string) {
  const audio = msg.audio!;
  msg.audio = undefined; // base64 nunca vai p/ o Redis
  let text: string | null = null;
  try {
    const data = audio.data ?? (await getAdapter(msg.channel).downloadMedia?.(audio.mediaId!))?.data;
    if (data) text = await transcribeAudio({ mimetype: audio.mimetype, data }, { conversationId });
  } catch (err) {
    logError("audio.prepare_failed", err, { conversationId });
  }
  msg.text = text
    ? `🎤 (áudio) ${text}`
    : "[o cliente enviou um áudio, mas não foi possível entender — peça com gentileza para repetir ou escrever]";
  await prisma.message.update({ where: { providerMsgId: msg.providerMsgId }, data: { text: msg.text } });
}
