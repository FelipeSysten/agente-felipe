import "server-only";
import type { AIRule, AgentSession, Conversation } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ChannelMessage } from "@/lib/channels/types";

export type Decision =
  | { action: "respond"; agentSession: AgentSession; ruleId?: string }
  | { action: "drop"; reason: string }
  | { action: "handoff"; reason: string; ruleId: string }
  | { action: "static_reply"; text: string; ruleId: string };

type Params = {
  keywords?: string[];
  matchMode?: "any" | "all";
  externalIds?: string[];
  tags?: string[];
  timezone?: string;
  days?: number[]; // 1=seg … 7=dom
  start?: string; // "HH:MM"
  end?: string;
  silenceHours?: number;
};

const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function matchesKeywords(p: Params, msgs: ChannelMessage[]): boolean {
  const kws = (p.keywords ?? []).map(normalize).filter(Boolean);
  if (!kws.length) return false;
  const text = normalize(msgs.map((m) => m.text).join(" \n "));
  return p.matchMode === "all" ? kws.every((k) => text.includes(k)) : kws.some((k) => text.includes(k));
}

function insideSchedule(p: Params, now: Date): boolean {
  const tz = p.timezone ?? "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  const hhmm = `${get("hour")}:${get("minute")}`;
  if (p.days?.length && !p.days.includes(day)) return false;
  const start = p.start ?? "00:00";
  const end = p.end ?? "23:59";
  return start <= end ? hhmm >= start && hhmm <= end : hhmm >= start || hhmm <= end;
}

async function recentOperatorMessage(conversationId: string, hours: number): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const n = await prisma.message.count({
    where: { conversationId, role: "operator", createdAt: { gte: since } },
  });
  return n > 0;
}

async function evaluateRule(
  rule: AIRule,
  msgs: ChannelMessage[],
  conv: Conversation & { contact: { tags: string[] } },
): Promise<boolean> {
  const p = (rule.params ?? {}) as Params;
  const externalId = msgs[0]?.externalId ?? "";
  switch (rule.mode) {
    case "always_on":
      return true;
    case "contact_whitelist":
    case "contact_blacklist": {
      // compara com o externalId do canal, nunca com o cuid interno
      const byId = (p.externalIds ?? []).includes(externalId);
      const byTag = (p.tags ?? []).some((t) => conv.contact.tags.includes(t));
      return byId || byTag;
    }
    case "keyword_trigger":
    case "keyword_pause":
      return matchesKeywords(p, msgs);
    case "schedule":
      return insideSchedule(p, new Date());
    case "human_takeover":
      return recentOperatorMessage(conv.id, p.silenceHours ?? 24);
    default:
      return false;
  }
}

export async function decideAction(
  msgs: ChannelMessage[],
  conv: Conversation & { contact: { tags: string[] } },
): Promise<Decision> {
  // Override manual do atendente vence tudo
  if (!conv.aiEnabled) return { action: "drop", reason: "conversation.aiEnabled=false" };
  // Atendente humano escreveu há pouco: IA fica calada até a pausa expirar
  if (conv.aiPausedUntil && conv.aiPausedUntil > new Date()) {
    return { action: "drop", reason: `human_pause_until:${conv.aiPausedUntil.toISOString()}` };
  }

  const agentSession = conv.agentSessionId
    ? await prisma.agentSession.findUnique({ where: { id: conv.agentSessionId } })
    : await prisma.agentSession.findFirst({ where: { isDefault: true } });
  if (!agentSession) return { action: "drop", reason: "no_default_agent_session" };

  const rules = await prisma.aIRule.findMany({
    where: { agentSessionId: agentSession.id, enabled: true },
    orderBy: { priority: "asc" },
  });

  for (const rule of rules) {
    if (!(await evaluateRule(rule, msgs, conv))) continue;
    switch (rule.action) {
      case "respond":
        return { action: "respond", agentSession, ruleId: rule.id };
      case "drop":
        return { action: "drop", reason: `rule:${rule.id}:${rule.mode}` };
      case "handoff":
        return { action: "handoff", reason: `rule:${rule.id}:${rule.mode}`, ruleId: rule.id };
      case "static_reply":
        return { action: "static_reply", text: rule.staticReply ?? "", ruleId: rule.id };
    }
  }
  return { action: "respond", agentSession };
}
