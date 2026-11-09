import { getEnabledAdapters } from "@/lib/channels/registry";
import { getSettings } from "@/lib/settings";
import type { SessionState } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

/**
 * Monitor externo (UptimeRobot): 200 só se todo canal configurado estiver
 * conectado. 503 + motivo curto caso contrário — o alerta já diz o que caiu.
 * Público de propósito: expõe só o estado, nunca URLs/credenciais.
 */
const REASON: Record<string, Partial<Record<SessionState, string>>> = {
  waha: {
    NOT_CONFIGURED: "servidor do WhatsApp (gateway no PC) não registrado — PC desligado ou gateway parado",
    FAILED: "gateway inacessível — PC desligado, sem internet ou túnel caído",
    STOPPED: "número desconectado — escaneie o QR em Canais WhatsApp",
    NOT_CREATED: "sessão não criada — clique em Conectar em Canais WhatsApp",
    SCAN_QR: "aguardando leitura do QR code",
    STARTING: "conectando…",
  },
  whatsapp_cloud: {
    FAILED: "API oficial da Meta recusou ou está inacessível — token expirado/inválido ou app sem inscrição nos webhooks",
  },
};

export async function GET() {
  const adapters = getEnabledAdapters();
  const settings = await getSettings();
  const channels = await Promise.all(
    adapters.map(async (a) => {
      const s = await a.getSessionStatus().catch(() => ({ state: "FAILED" as const }));
      return { channel: a.id, state: s.state, ok: s.state === "WORKING", reason: REASON[a.id]?.[s.state] };
    }),
  );
  const ok = channels.length > 0 && channels.every((c) => c.ok);
  const registeredAgoMin = settings.wahaBaseUrlAt
    ? Math.round((Date.now() - settings.wahaBaseUrlAt.getTime()) / 60_000)
    : null;
  return Response.json(
    { ok, channels, gatewayRegisteredMinutesAgo: registeredAgoMin },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
