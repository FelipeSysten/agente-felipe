import Link from "next/link";
import { prisma } from "@/lib/db";
import { visibleConversations } from "@/lib/lines";
import { getRedis } from "@/lib/redis";
import { allAdapters } from "@/lib/channels/registry";
import { hoursAgo, nowMs } from "@/lib/time";
import { conversationState, prettyPhone, sinceLabel } from "@/lib/conversation-state";
import { AutoRefresh } from "@/components/auto-refresh";
import { Page, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { clearDlq } from "../actions";

const tz = { timeZone: "America/Sao_Paulo" } as const;

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="text-3xl leading-none font-bold tabular-nums">{value}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function TodayPage() {
  const since = hoursAgo(24);
  const visible = await visibleConversations();
  const [waiting, conversations24h, inbound24h, aiReplies24h, humanReplies24h, pendingLessons, channels, dlqSize] =
    await Promise.all([
      prisma.conversation.findMany({
        where: { AND: [visible, { handoffRequested: true }] },
        orderBy: { lastMessageAt: "asc" },
        include: {
          contact: { include: { identities: true } },
          messages: { where: { role: "user" }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.conversation.count({ where: { AND: [visible, { lastMessageAt: { gte: since } }] } }),
      prisma.message.count({ where: { direction: "inbound", createdAt: { gte: since }, conversation: visible } }),
      prisma.message.count({ where: { role: "assistant", createdAt: { gte: since }, conversation: visible } }),
      prisma.message.count({ where: { role: "operator", createdAt: { gte: since }, conversation: visible } }),
      prisma.lesson.count({ where: { status: "pending" } }),
      Promise.all(allAdapters().map(async (a) => ({ adapter: a, status: await a.getSessionStatus() }))),
      (async () => getRedis().llen("dlq:llm_flush"))().catch(() => 0),
    ]);
  const now = nowMs();
  const today = new Date(now).toLocaleDateString("pt-BR", { ...tz, weekday: "long", day: "numeric", month: "long" });
  const configured = channels.filter((c) => c.status.state !== "NOT_CONFIGURED");
  const down = configured.filter((c) => c.status.state !== "WORKING");

  return (
    <Page title="Hoje" description={<span className="first-letter:uppercase">{today}</span>}>
      <AutoRefresh seconds={15} />

      {down.length > 0 && (
        <div role="alert" className="mb-7 rounded-lg border border-alert/30 bg-alert-soft px-4 py-3 text-[15px] text-alert">
          <p className="font-semibold">O WhatsApp não está respondendo clientes.</p>
          <p className="mt-0.5">
            {down.map((c) => c.status.detail ?? c.status.state).join(" ")}{" "}
            <Link href="/onboarding" className="font-semibold underline underline-offset-2">
              Ver conexão
            </Link>
          </p>
        </div>
      )}

      <Section
        title={waiting.length ? `Precisa de você (${waiting.length})` : "Precisa de você"}
        description={waiting.length ? "Clientes que pediram atendente ou reserva. A IA está pausada nessas conversas." : undefined}
      >
        {waiting.length === 0 ? (
          <p className="rounded-lg bg-accent px-4 py-4 text-[15px] text-accent-foreground">
            Ninguém esperando. A IA está dando conta do atendimento.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {waiting.map((c) => {
              const ident = c.contact.identities.find((i) => i.channel === c.channel);
              const named = c.contact.displayName && !c.contact.displayName.includes("@");
              const state = conversationState(c, now);
              return (
                <li key={c.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/conversations/${c.id}`}
                    className="flex items-center gap-4 px-5 py-4 shadow-[inset_4px_0_0_var(--alert)] hover:bg-alert-soft/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {named ? c.contact.displayName : prettyPhone(ident?.externalId)}{" "}
                        <span className="font-normal text-alert">{state.label.toLowerCase()}</span>
                      </p>
                      {c.messages[0] && (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">&ldquo;{c.messages[0].text}&rdquo;</p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-alert tabular-nums">
                      {sinceLabel(c.lastMessageAt, now)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Últimas 24 horas">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          <Stat value={conversations24h} label="conversas" />
          <Stat value={inbound24h} label="mensagens de clientes" />
          <Stat value={aiReplies24h} label="respostas da IA" />
          <Stat value={humanReplies24h} label="respostas da equipe" />
        </div>
      </Section>

      <Section
        title="WhatsApp"
        aside={
          <Button variant="outline" size="sm" render={<Link href="/onboarding" />}>
            Ver conexão
          </Button>
        }
      >
        <ul className="space-y-2 text-[15px]">
          {channels.map(({ adapter, status }) => {
            const ok = status.state === "WORKING";
            const off = status.state === "NOT_CONFIGURED";
            return (
              <li key={adapter.id} className="flex items-center gap-2.5">
                <span aria-hidden className={`size-2.5 rounded-full ${ok ? "bg-primary" : off ? "bg-border" : "bg-alert"}`} />
                <span className="font-medium">{adapter.id === "waha" ? "WhatsApp pelo QR code" : "API oficial da Meta"}</span>
                <span className="text-muted-foreground">
                  {ok ? `conectado${status.phone ? `, ${prettyPhone(status.phone)}` : ""}` : off ? "não configurado" : "fora do ar"}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      {(pendingLessons > 0 || dlqSize > 0) && (
        <Section title="Para revisar">
          <ul className="space-y-3 text-[15px]">
            {pendingLessons > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {pendingLessons} {pendingLessons === 1 ? "resposta da equipe pode virar" : "respostas da equipe podem virar"}{" "}
                  conhecimento da IA.
                </span>
                <Button size="sm" variant="outline" render={<Link href="/learning" />}>
                  Revisar sugestões
                </Button>
              </li>
            )}
            {dlqSize > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-alert">
                  {dlqSize} {dlqSize === 1 ? "resposta falhou" : "respostas falharam"} ao enviar. Os detalhes estão nos logs da Vercel.
                </span>
                <form action={clearDlq}>
                  <Button type="submit" variant="ghost" size="sm">
                    Limpar aviso
                  </Button>
                </form>
              </li>
            )}
          </ul>
        </Section>
      )}
    </Page>
  );
}
