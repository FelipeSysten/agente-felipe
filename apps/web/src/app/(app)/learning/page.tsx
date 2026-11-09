import Link from "next/link";
import { prisma } from "@/lib/db";
import { nowMs } from "@/lib/time";
import { sinceLabel } from "@/lib/conversation-state";
import { ActionForm } from "@/components/action-form";
import { Page, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveLesson, createLesson, deleteLesson, rejectLesson } from "../actions";

const SOURCE: Record<string, string> = {
  operator: "Resposta do atendente",
  correction: "Correção de uma resposta da IA",
  manual: "Ensinado aqui",
};

function LessonFields({ question, answer, id }: { question: string; answer: string; id: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`q-${id}`}>Quando o cliente perguntar</Label>
        <Textarea id={`q-${id}`} name="question" rows={3} defaultValue={question} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`a-${id}`}>A IA responde</Label>
        <Textarea id={`a-${id}`} name="answer" rows={3} defaultValue={answer} />
      </div>
    </div>
  );
}

export default async function LearningPage() {
  const [pending, approved] = await Promise.all([
    prisma.lesson.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.lesson.findMany({ where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ]);
  const now = nowMs();

  return (
    <Page
      title="Ensinar a IA"
      description="Quando alguém da equipe responde um cliente ou corrige a IA, isso vira uma sugestão aqui. Depois de aprovada, a IA passa a responder assim."
    >
      <Section
        title={pending.length ? `Sugestões para revisar (${pending.length})` : "Sugestões para revisar"}
        description={
          pending.length
            ? "O número também recebe conversas pessoais: descarte o que não for de cliente e tire nomes ou valores de um pedido específico antes de aprovar."
            : undefined
        }
      >
        {pending.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">
            Nada para revisar. Novas sugestões aparecem quando a equipe responde clientes.
          </p>
        ) : (
          <ol className="space-y-4">
            {pending.map((l) => (
              <li key={l.id} className="rounded-lg border border-border bg-card p-4 md:p-5">
                <p className="mb-3 text-sm text-muted-foreground">
                  {SOURCE[l.source] ?? l.source}, {sinceLabel(l.createdAt, now)}
                  {l.conversationId && (
                    <>
                      {". "}
                      <Link href={`/conversations/${l.conversationId}`} className="font-medium text-primary hover:underline">
                        Abrir conversa
                      </Link>
                    </>
                  )}
                </p>
                <ActionForm action={approveLesson.bind(null, l.id)} submitLabel="Aprovar" className="space-y-3">
                  <LessonFields id={l.id} question={l.question} answer={l.answer} />
                </ActionForm>
                <form action={rejectLesson.bind(null, l.id)} className="mt-2">
                  <Button type="submit" variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                    Descartar
                  </Button>
                </form>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Ensinar algo novo" description="Horário, formas de pagamento, taxa por bairro, se faz meio a meio. O que os clientes mais perguntam.">
        <ActionForm action={createLesson} submitLabel="Ensinar" className="space-y-3">
          <LessonFields id="new" question="" answer="" />
        </ActionForm>
      </Section>

      <Section
        title={`O que a IA já sabe (${approved.length})`}
        description="Mudou alguma coisa, como o horário? Abra e edite. O que não vale mais pode ser excluído."
      >
        {approved.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">Nada aprovado ainda.</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {approved.map((l) => (
              <li key={l.id} className="border-b border-border last:border-b-0">
                <details className="group">
                  <summary className="cursor-pointer list-none px-5 py-3.5 hover:bg-accent/40">
                    <p className="font-medium">{l.question.split("\n")[0]}</p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{l.answer}</p>
                  </summary>
                  <div className="space-y-3 border-t border-border px-5 py-4">
                    <p className="text-sm text-muted-foreground">{SOURCE[l.source] ?? l.source}</p>
                    <ActionForm action={approveLesson.bind(null, l.id)} submitLabel="Salvar alteração" className="space-y-3">
                      <LessonFields id={l.id} question={l.question} answer={l.answer} />
                    </ActionForm>
                    <form action={deleteLesson.bind(null, l.id)}>
                      <Button type="submit" variant="ghost" size="sm" className="-ml-2 text-alert">
                        Excluir
                      </Button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
