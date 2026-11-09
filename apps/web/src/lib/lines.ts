import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { logEvent } from "@/lib/log";
import { canonicalPhone } from "@/lib/phone";

/**
 * Registra qual número está conectado no QR code (null = nenhum). Ao trocar de
 * número, as conversas do anterior somem do painel (continuam no banco).
 */
export async function setWahaLine(phone: string | null) {
  const line = phone ? canonicalPhone(phone) || null : null;
  const current = (await getSettings()).wahaLine ?? null;
  if (current === line) return;
  await prisma.appSettings.update({ where: { id: "singleton" }, data: { wahaLine: line } });
  logEvent("line.changed", { channel: "waha", before: current ? `…${current.slice(-4)}` : null, after: line ? `…${line.slice(-4)}` : null });
}

/** Filtro das conversas visíveis: só as do número conectado agora (QR) + API oficial. */
export async function visibleConversations(): Promise<Prisma.ConversationWhereInput> {
  const { wahaLine } = await getSettings();
  return {
    OR: [
      // Sem número conectado: nenhuma conversa do QR aparece (linhas são só dígitos;
      // o Postgres não aceita \u0000 em texto, então o "nunca casa" é um texto comum)
      { channel: "waha", line: wahaLine ?? "nenhum-numero-conectado" },
      { channel: { not: "waha" } },
    ],
  };
}
