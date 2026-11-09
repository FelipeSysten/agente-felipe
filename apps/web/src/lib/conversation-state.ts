/**
 * Estado de uma conversa do ponto de vista de quem atende — a única coisa que
 * ganha cor no painel. Puro (sem DB); `now` vem de fora p/ funcionar em qualquer lado.
 */
export type ConversationKind = "waiting" | "human" | "paused" | "ai";

export interface ConversationLike {
  aiEnabled: boolean;
  handoffRequested: boolean;
  handoffRoute?: string | null;
  aiPausedUntil?: Date | string | null;
}

export function conversationState(c: ConversationLike, now: number) {
  if (c.handoffRequested) {
    return {
      kind: "waiting" as const,
      label: c.handoffRoute === "reservas" ? "Quer reservar mesa" : "Pediu atendente",
    };
  }
  if (!c.aiEnabled) return { kind: "paused" as const, label: "IA pausada" };
  const until = c.aiPausedUntil ? new Date(c.aiPausedUntil).getTime() : 0;
  if (until > now) return { kind: "human" as const, label: "Atendente respondendo" };
  return { kind: "ai" as const, label: "IA atendendo" };
}

/** "agora", "há 4 min", "há 2 h", "ontem 21:10", "12/10 14:02" */
export function sinceLabel(date: Date | string | null | undefined, now: number): string {
  if (!date) return "";
  const d = new Date(date);
  const min = Math.floor((now - d.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 6 * 60) return `há ${Math.floor(min / 60)} h`;
  const tz = { timeZone: "America/Sao_Paulo" } as const;
  const day = (x: Date | number) => new Date(x).toLocaleDateString("pt-BR", tz);
  const time = d.toLocaleTimeString("pt-BR", { ...tz, hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(now)) return time;
  if (day(d) === day(now - 86_400_000)) return `ontem ${time}`;
  return `${d.toLocaleDateString("pt-BR", { ...tz, day: "2-digit", month: "2-digit" })} ${time}`;
}

/** Telefone legível: 5573999091977@c.us → (73) 99909-1977 */
export function prettyPhone(externalId: string | undefined | null): string {
  if (!externalId) return "";
  if (externalId.endsWith("@lid")) return "número oculto";
  const d = externalId.replace(/@.*/, "").replace(/\D/g, "");
  const br = d.startsWith("55") ? d.slice(2) : d;
  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return `+${d}`;
}
