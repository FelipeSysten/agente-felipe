import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { ROUTE_DEFAULTS } from "@/lib/handoff-routes";
import { ActionForm } from "@/components/action-form";
import { Page, Section } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireUser } from "@/lib/auth";
import { adminEmails } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { addAdmin, changeOwnPassword, removeAdmin, saveSettings } from "../actions";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function SettingsPage() {
  const myEmail = await requireUser();
  const settings = await getSettings();
  const admins = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  const me = admins.find((a) => a.email === myEmail);
  // Quem só está na ADMIN_EMAILS (Vercel) e ainda não criou login e senha
  const envOnly = adminEmails().filter((e) => !admins.some((a) => a.email === e));
  const agent = await prisma.agentSession.findFirst({ where: { isDefault: true } });
  const rules = agent
    ? await prisma.aIRule.findMany({ where: { agentSessionId: agent.id, mode: "keyword_pause", action: "handoff" } })
    : [];
  type P = { route?: string; keywords?: string[]; phone?: string; reply?: string };
  const byRoute = (route: string) => rules.find((r) => ((r.params as P | null)?.route ?? "atendimento") === route);
  const atendimento = byRoute("atendimento");
  const orcamento = byRoute("orcamento");
  const op = (orcamento?.params ?? {}) as P;
  const keywords = ((atendimento?.params as P | null)?.keywords ?? ROUTE_DEFAULTS.atendimento.keywords).join(", ");

  return (
    <Page title="Ajustes" description="Valem para todas as conversas a partir da próxima mensagem.">
      <ActionForm action={saveSettings} submitLabel="Salvar ajustes" className="space-y-0 pb-4">
        <Section title="Você" description="Aparecem nas respostas da IA no lugar de {{BUSINESS_NAME}} e {{LINK}}.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="businessName" label="Nome ou marca">
              <Input id="businessName" name="businessName" defaultValue={settings.businessName} required />
            </Field>
            <Field id="deliveryUrl" label="Link do portfólio (site, Behance, Instagram…)">
              <Input id="deliveryUrl" name="deliveryUrl" type="url" defaultValue={settings.deliveryUrl} placeholder="https://" />
            </Field>
          </div>
        </Section>

        <Section
          title="Quando o cliente quer falar com você"
          description="A IA pausa naquela conversa, responde o cliente e marca a conversa em Precisa de você. Se houver um número abaixo, ele também recebe um aviso no WhatsApp."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="handoffKeywords" label="Palavras que acionam" hint="Separe por vírgula.">
              <Input id="handoffKeywords" name="handoffKeywords" defaultValue={keywords} />
            </Field>
            <Field id="handoffPhone" label="WhatsApp para avisos (opcional)" hint="Com DDI e DDD, só números. Deixe vazio se o aviso iria para o próprio número conectado. A IA nunca responde esse número.">
              <Input id="handoffPhone" name="handoffPhone" inputMode="numeric" defaultValue={settings.handoffPhone} placeholder="5511999999999" />
            </Field>
            <div className="md:col-span-2">
              <Field id="handoffReply" label="O que o cliente recebe">
                <Textarea id="handoffReply" name="handoffReply" rows={2} defaultValue={settings.handoffReply} />
              </Field>
            </div>
          </div>
        </Section>

        <Section
          title="Quando o cliente pede orçamento"
          description="Depois que o cliente explica o que precisa e pede valor, a IA pausa e marca a conversa como Quer orçamento, com o que ele escreveu."
        >
          <label className="mb-4 flex items-center gap-2.5 text-[15px]">
            <input type="checkbox" name="orcamentoEnabled" defaultChecked={orcamento ? orcamento.enabled : true} className="size-4 accent-primary" />
            Encaminhar pedidos de orçamento
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="orcamentoKeywords" label="Palavras que acionam" hint="Separe por vírgula. A IA também reconhece o pedido sem elas.">
              <Input id="orcamentoKeywords" name="orcamentoKeywords" defaultValue={(op.keywords ?? ROUTE_DEFAULTS.orcamento.keywords).join(", ")} />
            </Field>
            <Field id="orcamentoPhone" label="WhatsApp para avisos (opcional)" hint="Com DDI e DDD, só números. Vazio = só marca no painel.">
              <Input id="orcamentoPhone" name="orcamentoPhone" inputMode="numeric" defaultValue={op.phone ?? ""} placeholder="5511999999999" />
            </Field>
            <div className="md:col-span-2">
              <Field id="orcamentoReply" label="O que o cliente recebe">
                <Textarea id="orcamentoReply" name="orcamentoReply" rows={3} defaultValue={op.reply ?? ROUTE_DEFAULTS.orcamento.reply} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Ritmo da IA">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="humanPauseSeconds"
              label="Pausa depois que você responde (segundos)"
              hint="A IA fica calada nessa conversa por esse tempo; cada mensagem sua recomeça a contagem. 1800 = 30 min. 0 desliga."
            >
              <Input id="humanPauseSeconds" name="humanPauseSeconds" type="number" min={0} max={86400} step={5} defaultValue={settings.humanPauseSeconds} />
            </Field>
            <Field
              id="debounceWindowMs"
              label="Espera antes de responder (milissegundos)"
              hint="Junta mensagens seguidas numa resposta só. 5000 = 5 segundos; entre 3000 e 15000."
            >
              <Input id="debounceWindowMs" name="debounceWindowMs" type="number" min={3000} max={15000} step={500} defaultValue={settings.debounceWindowMs} />
            </Field>
          </div>
        </Section>
      </ActionForm>

      <Section
        title="Acesso ao painel"
        description="Cada pessoa entra com o próprio login e senha. O link por e-mail continua funcionando para todos daqui."
      >
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {a.name}
                  {a.email === myEmail && <span className="ml-2 text-sm font-normal text-muted-foreground">(você)</span>}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  login <span className="font-medium text-foreground">{a.username}</span> · {a.email}
                  {!a.passwordHash && " · sem senha"}
                </p>
              </div>
              {a.email !== myEmail && !adminEmails().includes(a.email) && (
                <form action={removeAdmin.bind(null, a.id)}>
                  <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
                    Remover
                  </Button>
                </form>
              )}
            </li>
          ))}
          {envOnly.map((e) => (
            <li key={e} className="px-4 py-3">
              <p className="font-medium">{e}{e === myEmail && <span className="ml-2 text-sm font-normal text-muted-foreground">(você)</span>}</p>
              <p className="text-sm text-muted-foreground">Só entra pelo link do e-mail, ainda sem login e senha</p>
            </li>
          ))}
        </ul>

        <div className="mt-7 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-3 font-semibold">{me?.passwordHash ? "Trocar minha senha" : "Criar meu login e senha"}</h3>
            <ActionForm action={changeOwnPassword} submitLabel="Salvar senha">
              {!me && (
                <Field id="me-name" label="Seu nome">
                  <Input id="me-name" name="name" autoComplete="name" />
                </Field>
              )}
              <Field id="me-username" label="Login" hint="Letras minúsculas, sem espaço. Ex.: felipe">
                <Input id="me-username" name="username" autoCapitalize="none" autoComplete="username" defaultValue={me?.username ?? myEmail.split("@")[0].replace(/[^a-z0-9._-]/g, "")} required />
              </Field>
              {me?.passwordHash && (
                <Field id="me-current" label="Senha atual">
                  <Input id="me-current" name="current" type="password" autoComplete="current-password" required />
                </Field>
              )}
              <Field id="me-password" label="Nova senha" hint="Pelo menos 8 caracteres.">
                <Input id="me-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
              </Field>
              <Field id="me-confirm" label="Repita a nova senha">
                <Input id="me-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
              </Field>
            </ActionForm>
          </div>

          <div>
            <h3 className="mb-3 font-semibold">Adicionar administrador</h3>
            <ActionForm action={addAdmin} submitLabel="Adicionar">
              <Field id="new-name" label="Nome">
                <Input id="new-name" name="name" required />
              </Field>
              <Field id="new-username" label="Login" hint="Letras minúsculas, sem espaço. Ex.: maria">
                <Input id="new-username" name="username" autoCapitalize="none" required />
              </Field>
              <Field id="new-email" label="E-mail">
                <Input id="new-email" name="email" type="email" required />
              </Field>
              <Field id="new-password" label="Senha" hint="Deixe em branco para gerar uma provisória.">
                <Input id="new-password" name="password" type="password" autoComplete="new-password" />
              </Field>
            </ActionForm>
          </div>
        </div>
      </Section>
    </Page>
  );
}
