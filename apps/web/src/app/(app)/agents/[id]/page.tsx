import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { providerOptions } from "@/lib/llm";
import { ActionForm } from "@/components/action-form";
import { Page, Section } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveAgent, testAgent } from "../../actions";

const PROVIDER: Record<string, string> = { groq: "Groq", google: "Gemini (Google)", anthropic: "Claude (Anthropic)" };
const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2.5 text-[15px] outline-none focus-visible:border-ring";

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const agent = await prisma.agentSession.findUnique({ where: { id } });
  if (!agent) notFound();
  const providers = providerOptions();
  // Ordem real da cadeia: o principal primeiro, depois os demais
  const chain = [...providers].sort((a, b) => Number(b.id === agent.provider) - Number(a.id === agent.provider));

  return (
    <Page
      title={agent.name}
      description={
        <Link href="/agents" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Agentes
        </Link>
      }
    >
      <ActionForm action={saveAgent.bind(null, agent.id)} submitLabel="Salvar agente" className="space-y-0 pb-8">
        <Section
          title="Como a IA atende"
          description={
            <>
              Escreva como falaria com um atendente novo. Use {"{{DELIVERY_URL}}"} para o link do pedido e {"{{BUSINESS_NAME}}"} para
              o nome da casa. Fatos como horário e taxa ficam melhor em Ensinar a IA.
            </>
          }
        >
          <div className="space-y-4">
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="name">Nome do agente</Label>
              <Input id="name" name="name" defaultValue={agent.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="systemPrompt">Instruções</Label>
              <Textarea
                id="systemPrompt"
                name="systemPrompt"
                rows={16}
                defaultValue={agent.systemPrompt}
                required
                className="text-[15px] leading-relaxed"
              />
            </div>
          </div>
        </Section>

        <Section
          title="Modelo de IA"
          description={`Se o principal falhar ou estourar a cota grátis, a resposta passa para o próximo: ${chain
            .map((p) => PROVIDER[p.id] ?? p.id)
            .join(", depois ")}.`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="provider">Provedor principal</Label>
              <select id="provider" name="provider" defaultValue={agent.provider} className={selectClass}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {PROVIDER[p.id] ?? p.id}
                    {p.available ? "" : " (sem chave configurada)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Modelo</Label>
              <Input id="model" name="model" defaultValue={agent.model} required list="model-suggestions" />
              <datalist id="model-suggestions">
                {providers.map((p) => (
                  <option key={p.id} value={p.defaultModel} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="temperature">Criatividade (0 a 2)</Label>
              <Input id="temperature" name="temperature" type="number" step="0.1" min="0" max="2" defaultValue={agent.temperature} />
              <p className="text-xs text-muted-foreground">Mais baixo, respostas mais previsíveis.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxTokens">Tamanho máximo da resposta (tokens)</Label>
              <Input id="maxTokens" name="maxTokens" type="number" min="64" max="4096" defaultValue={agent.maxTokens} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memoryMode">Quanto da conversa ela lembra</Label>
              <select id="memoryMode" name="memoryMode" defaultValue={agent.memoryMode} className={selectClass}>
                <option value="window_10">Últimas 10 mensagens</option>
                <option value="window_20">Últimas 20 mensagens</option>
                <option value="window_40">Últimas 40 mensagens</option>
                <option value="stateless">Só a mensagem atual</option>
              </select>
            </div>
            <label className="flex items-center gap-2.5 self-end pb-2 text-[15px]">
              <input type="checkbox" name="isDefault" defaultChecked={agent.isDefault} className="size-4 accent-primary" />
              Atende todas as conversas novas
            </label>
          </div>
        </Section>
      </ActionForm>

      <Section
        title="Testar sem enviar"
        description="Escreva como se fosse um cliente. A resposta aparece aqui e não vai para o WhatsApp (usa a versão salva)."
      >
        <ActionForm action={testAgent.bind(null, agent.id)} submitLabel="Ver resposta" className="space-y-3">
          <Textarea name="question" rows={2} placeholder="Oi, quero fazer um pedido" aria-label="Mensagem de teste" />
        </ActionForm>
      </Section>
    </Page>
  );
}
