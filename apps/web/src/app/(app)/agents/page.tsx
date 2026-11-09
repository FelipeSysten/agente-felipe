import Link from "next/link";
import { prisma } from "@/lib/db";
import { Page } from "@/components/page";

const PROVIDER: Record<string, string> = { groq: "Groq", google: "Gemini (Google)", anthropic: "Claude (Anthropic)" };

export default async function AgentsPage() {
  const agents = await prisma.agentSession.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return (
    <Page title="Agente" description="Como a IA se apresenta, o que ela sabe e qual modelo ela usa.">
      {agents.length === 0 ? (
        <p className="text-muted-foreground">Nenhum agente cadastrado. Rode o seed do banco (veja o README).</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {agents.map((a) => (
            <li key={a.id} className="border-b border-border last:border-b-0">
              <Link href={`/agents/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-accent/50">
                <span className="text-[17px] font-semibold">{a.name}</span>
                {a.isDefault && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                    Atende todas as conversas novas
                  </span>
                )}
                <span className="ml-auto text-sm text-muted-foreground">
                  {PROVIDER[a.provider] ?? a.provider}, modelo {a.model}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
