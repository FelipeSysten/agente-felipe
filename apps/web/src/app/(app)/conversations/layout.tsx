import { prisma } from "@/lib/db";
import { visibleConversations } from "@/lib/lines";
import { nowMs } from "@/lib/time";
import { conversationState, prettyPhone, sinceLabel } from "@/lib/conversation-state";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConversationsShell, type ConversationRow } from "@/components/conversations-shell";

const FROM: Record<string, string> = { assistant: "IA", operator: "Atendente", system: "Automático" };

export default async function ConversationsLayout({ children }: { children: React.ReactNode }) {
  const conversations = await prisma.conversation.findMany({
    where: await visibleConversations(),
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 150,
    include: {
      contact: { include: { identities: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const now = nowMs();

  const rows: ConversationRow[] = conversations.map((c) => {
    const ident = c.contact.identities.find((i) => i.channel === c.channel);
    const phone = prettyPhone(ident?.externalId);
    const named = c.contact.displayName && !c.contact.displayName.includes("@");
    const last = c.messages[0];
    const state = conversationState(c, now);
    return {
      id: c.id,
      name: named ? c.contact.displayName! : phone || "Cliente",
      phone,
      channelLabel: c.channel === "waha" ? "WhatsApp (QR)" : "API oficial",
      preview: last?.text ?? "",
      previewFrom: last ? (FROM[last.role] ?? "") : "",
      since: sinceLabel(c.lastMessageAt, now),
      kind: state.kind,
      stateLabel: state.label,
    };
  });
  // Quem espera atendimento sobe para o topo
  rows.sort((a, b) => Number(b.kind === "waiting") - Number(a.kind === "waiting"));

  return (
    <>
      <AutoRefresh seconds={5} />
      <ConversationsShell rows={rows}>{children}</ConversationsShell>
    </>
  );
}
