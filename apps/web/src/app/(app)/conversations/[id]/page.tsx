import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { isFuture, nowMs, within24h } from "@/lib/time";
import { getAdapter } from "@/lib/channels/registry";
import { conversationState, prettyPhone } from "@/lib/conversation-state";
import { ActionForm } from "@/components/action-form";
import { ScrollToBottom } from "@/components/scroll-to-bottom";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { correctMessage, replyAsOperator, setAi } from "../../actions";

const tz = { timeZone: "America/Sao_Paulo" } as const;
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { ...tz, hour: "2-digit", minute: "2-digit" });
const dayKey = (d: Date | number) => new Date(d).toLocaleDateString("pt-BR", tz);

function dayLabel(d: Date, now: number) {
  if (dayKey(d) === dayKey(now)) return "Hoje";
  if (dayKey(d) === dayKey(now - 86_400_000)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { ...tz, weekday: "long", day: "numeric", month: "long" });
}

const BUBBLE: Record<string, string> = {
  user: "self-start rounded-bl-sm border border-border bg-card",
  assistant: "self-end rounded-br-sm bg-accent text-accent-foreground",
  operator: "self-end rounded-br-sm bg-primary text-primary-foreground",
};
const AUTHOR: Record<string, string> = { assistant: "IA", operator: "Atendente" };

export default async function ConversationPage({ params }: PageProps<"/conversations/[id]">) {
  const { id } = await params;
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: { include: { identities: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 300 },
    },
  });
  if (!conv) notFound();

  const now = nowMs();
  const adapter = getAdapter(conv.channel);
  const windowOpen = !adapter.hasServiceWindow || within24h(conv.lastInboundAt);
  const humanPause = conv.aiEnabled && isFuture(conv.aiPausedUntil) ? conv.aiPausedUntil : null;
  const state = conversationState(conv, now);
  const ident = conv.contact.identities.find((i) => i.channel === conv.channel);
  const phone = prettyPhone(ident?.externalId);
  const named = conv.contact.displayName && !conv.contact.displayName.includes("@");
  const title = named ? conv.contact.displayName! : phone || "Cliente";

  return (
    // Celular: a conversa cobre a tela toda (como no WhatsApp), sem a navegação do painel por cima
    <div className="flex h-dvh flex-col bg-background max-md:fixed max-md:inset-0 max-md:z-30">
      <ScrollToBottom count={conv.messages.length} targetId="thread" />

      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-0">
          <Link href="/conversations" className="-ml-1 rounded p-1 text-muted-foreground hover:text-foreground md:hidden" aria-label="Voltar para a lista">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg leading-tight font-bold">{title}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {named && phone ? `${phone}, ` : ""}
              {adapter.label}
            </p>
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <StatusBadge kind={state.kind} label={state.label} />
          {/* Ação principal muda conforme o estado (§0.9.17: reativar sempre explícito) */}
          {conv.handoffRequested ? (
            <form action={setAi.bind(null, conv.id, true)}>
              <Button type="submit" size="sm">Resolvido, IA volta</Button>
            </form>
          ) : conv.aiEnabled ? (
            <form action={setAi.bind(null, conv.id, false)}>
              <Button type="submit" size="sm" variant="outline">Pausar IA</Button>
            </form>
          ) : (
            <form action={setAi.bind(null, conv.id, true)}>
              <Button type="submit" size="sm">Reativar IA</Button>
            </form>
          )}
        </div>
      </header>

      {humanPause && (
        <p className="border-b border-amber/30 bg-amber-soft px-4 py-2 text-sm text-amber md:px-6">
          Atendente respondeu: a IA fica calada nesta conversa até {hhmm(humanPause)} e depois volta sozinha.
        </p>
      )}

      <div id="thread" className="flex-1 overflow-y-auto px-4 py-5 md:px-8">
        <ol className="mx-auto flex max-w-2xl flex-col gap-2">
          {conv.messages.length === 0 && (
            <li className="py-10 text-center text-sm text-muted-foreground">Ainda não há mensagens nesta conversa.</li>
          )}
          {conv.messages.map((m, i) => {
            const prev = conv.messages[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            return (
              <li key={m.id} className="contents">
                {newDay && (
                  <p className="my-3 self-center rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground first-letter:uppercase">
                    {dayLabel(m.createdAt, now)}
                  </p>
                )}
                {m.role === "system" ? (
                  <p className="my-1 max-w-md self-center text-center text-xs text-muted-foreground">
                    Mensagem automática às {hhmm(m.createdAt)}: {m.text}
                  </p>
                ) : (
                  <div className={`flex max-w-[85%] flex-col ${m.role === "user" ? "items-start self-start" : "items-end self-end"}`}>
                    <div className={`rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap ${BUBBLE[m.role] ?? BUBBLE.user}`}>
                      {m.text}
                    </div>
                    <span className="mt-1 px-1 text-xs text-muted-foreground tabular-nums" title={m.modelUsed ?? undefined}>
                      {AUTHOR[m.role] ? `${AUTHOR[m.role]}, ` : ""}
                      {hhmm(m.createdAt)}
                    </span>
                    {m.role === "assistant" && (
                      <details className="w-full max-w-sm text-right">
                        <summary className="cursor-pointer px-1 text-xs font-medium text-primary hover:underline">
                          Corrigir esta resposta
                        </summary>
                        <ActionForm action={correctMessage.bind(null, m.id)} submitLabel="Ensinar a IA" className="mt-2 space-y-2 text-left">
                          <Textarea name="answer" rows={3} placeholder="Como a resposta deveria ter sido" />
                        </ActionForm>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="border-t border-border bg-card px-4 py-3 md:px-6">
        {windowOpen ? (
          <ActionForm action={replyAsOperator.bind(null, conv.id)} submitLabel="Enviar" className="mx-auto max-w-2xl space-y-2">
            <Textarea name="text" rows={2} placeholder="Responder como atendente" required aria-label="Mensagem para o cliente" />
          </ActionForm>
        ) : (
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
            Pela API oficial, só dá para responder depois que o cliente mandar uma nova mensagem (regra de 24h da Meta).
          </p>
        )}
      </footer>
    </div>
  );
}
