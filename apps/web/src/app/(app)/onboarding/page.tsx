import { Check, Minus } from "lucide-react";
import { whatsappCloudAdapter } from "@/lib/channels/whatsapp-cloud";
import { wahaAdapter } from "@/lib/channels/waha";
import { appUrl } from "@/lib/settings";
import { prettyPhone } from "@/lib/conversation-state";
import { ActionForm } from "@/components/action-form";
import { Page, Section } from "@/components/page";
import { WahaConnect } from "@/components/waha-connect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ensureChannel, sendTestMessage } from "../actions";

const ENV = [
  ["GROQ_API_KEY", "IA principal (Groq)"],
  ["GOOGLE_API_KEY", "IA reserva (Gemini)"],
  ["ANTHROPIC_API_KEY", "IA paga, último recurso (Anthropic)"],
  ["UPSTASH_REDIS_REST_URL", "Agrupamento de mensagens (Upstash)"],
  ["GMAIL_APP_PASSWORD", "E-mail do login (Gmail)"],
  ["WAHA_API_KEY", "Chave do gateway do QR code"],
  ["META_SYSTEM_USER_TOKEN", "Token da API oficial (Meta)"],
  ["META_WEBHOOK_VERIFY_TOKEN", "Verificação do webhook da Meta"],
] as const;

function Copyable({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} readOnly value={value} className="text-sm" />
    </div>
  );
}

const selectClass = "h-9 rounded-md border border-input bg-card px-2.5 text-[15px] outline-none focus-visible:border-ring";

export default async function WhatsAppPage() {
  const [cloud, wahaStatus] = await Promise.all([whatsappCloudAdapter.getSessionStatus(), wahaAdapter.getSessionStatus()]);
  const wahaQr = wahaStatus.state === "SCAN_QR" ? await wahaAdapter.getQrCode?.().catch(() => null) : null;
  const cloudOn = cloud.state === "WORKING";

  return (
    <Page title="WhatsApp" description="Os dois jeitos podem funcionar juntos: cada cliente é respondido pelo mesmo canal por onde escreveu.">
      <Section
        title="Número pelo QR code"
        description="Conecta um WhatsApp comum, como o WhatsApp Web, pelo gateway que roda no PC. Sem custo por mensagem. Evite envios em massa: o WhatsApp pode bloquear o número."
      >
        <WahaConnect initial={{ ...wahaStatus, qr: wahaQr ? `data:${wahaQr.mimetype};base64,${wahaQr.data}` : null }} />
      </Section>

      <Section
        title="API oficial da Meta"
        description={
          cloudOn
            ? `Conectada${cloud.verifiedName ? `: ${cloud.verifiedName}` : ""}${cloud.phone ? `, ${cloud.phone}` : ""}.`
            : cloud.state === "NOT_CONFIGURED"
              ? "Ainda não configurada. Precisa de um número dedicado e do token permanente da Meta."
              : (cloud.detail ?? "Não conectada.")
        }
      >
        <div className="space-y-4">
          <p className="text-[15px] text-muted-foreground">
            No app da Meta, abra WhatsApp, Configuration, Webhook e Edit. Cole os dois valores abaixo, confirme em Verify and save
            e assine o campo messages.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Copyable id="cb" label="Callback URL" value={`${appUrl()}/api/webhooks/whatsapp-cloud`} />
            <Copyable id="vt" label="Verify token" value={process.env.META_WEBHOOK_VERIFY_TOKEN ?? "defina META_WEBHOOK_VERIFY_TOKEN"} />
          </div>
          <ActionForm action={ensureChannel.bind(null, "whatsapp_cloud")} submitLabel={cloudOn ? "Verificar de novo" : "Conectar API oficial"} />
        </div>
      </Section>

      <Section title="Mandar uma mensagem de teste" description="Pela API oficial, só chega para quem escreveu para o número nas últimas 24 horas.">
        <ActionForm action={sendTestMessage} submitLabel="Enviar teste" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select name="channel" aria-label="Por qual canal" className={selectClass} defaultValue={wahaStatus.state === "WORKING" ? "waha" : "whatsapp_cloud"}>
              <option value="waha">Pelo QR code</option>
              <option value="whatsapp_cloud">Pela API oficial</option>
            </select>
            <Input name="to" placeholder="Número com DDI, ex.: 5573999999999" inputMode="numeric" required aria-label="Número" className="max-w-xs" />
          </div>
        </ActionForm>
      </Section>

      <Section title="Detalhes técnicos">
        <details>
          <summary className="cursor-pointer text-[15px] font-medium text-primary">Ver o que está configurado na Vercel</summary>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {ENV.map(([key, label]) => {
              const ok = Boolean(process.env[key]);
              return (
                <li key={key} className={`flex items-center gap-2 text-sm ${ok ? "" : "text-muted-foreground"}`}>
                  {ok ? <Check className="size-4 text-primary" aria-label="configurado" /> : <Minus className="size-4" aria-label="não configurado" />}
                  {label}
                </li>
              );
            })}
          </ul>
          {wahaStatus.phone && <p className="mt-3 text-sm text-muted-foreground">Número no QR code: {prettyPhone(wahaStatus.phone)}</p>}
        </details>
      </Section>
    </Page>
  );
}
