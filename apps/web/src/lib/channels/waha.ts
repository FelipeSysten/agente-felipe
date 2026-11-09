import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl, getSettings } from "@/lib/settings";
import { setWahaLine } from "@/lib/lines";
import { canonicalPhone } from "@/lib/phone";
import { logEvent } from "@/lib/log";
import type { ChannelAdapter, ChannelMessage, SessionState, SessionStatus } from "./types";

// Waha Core só suporta a sessão "default".
const SESSION = "default";

/**
 * URL do Waha/gateway: env fixa (VPS) ou a registrada pelo gateway no banco
 * (túnel do PC, que muda a cada reinício).
 */
async function base(): Promise<string> {
  const url = process.env.WAHA_BASE_URL || (await getSettings()).wahaBaseUrl || "";
  return url.replace(/\/$/, "");
}

async function waha(path: string, init: RequestInit = {}): Promise<Response> {
  const root = await base();
  if (!root) throw new Error("URL do servidor WhatsApp (QR) ainda não registrada");
  return fetch(`${root}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
}

/** Classifica 422 do Waha: estados "já atingidos" não são erro (sub-prompt waha.md). */
async function classify(res: Response): Promise<"ok" | "put" | "error"> {
  if (res.status !== 422) return res.ok ? "ok" : "error";
  const msg = String(((await res.clone().json().catch(() => ({}))) as { message?: string }).message ?? "");
  if (/already exists/i.test(msg)) return "put";
  if (/is already (started|stopped)|is not started|status is (STARTING|SCAN_QR_CODE|WORKING)/i.test(msg)) {
    return "ok";
  }
  return "error";
}

/** HMAC-SHA512 do raw body (header X-Webhook-Hmac), com WAHA_HMAC_KEY. */
export function verifyWahaSignature(rawBody: string, header: string | null): boolean {
  const key = process.env.WAHA_HMAC_KEY;
  if (!key || !header) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest();
  const given = Buffer.from(header.replace(/^sha512[:=]/, ""), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Telefone só com dígitos vira chatId; IDs com "@" (c.us/lid) passam intactos (§0.9.21). */
function toChatId(to: string): string {
  if (to.includes("@")) return to;
  if (!/^\d{8,15}$/.test(to)) throw new Error(`destinatário inválido p/ Waha: ${to.slice(0, 6)}…`);
  return `${to}@c.us`;
}

function sessionConfig() {
  return {
    webhooks: [
      {
        url: `${appUrl()}/api/webhooks/waha`,
        // Nunca message.any: entrega a mesma msg várias vezes (§0.9.4)
        events: ["message", "session.status"],
        hmac: { key: process.env.WAHA_HMAC_KEY },
        retries: { policy: "linear", delaySeconds: 2, attempts: 4 },
      },
    ],
  };
}

const STATUS_MAP: Record<string, SessionState> = {
  STOPPED: "STOPPED",
  STARTING: "STARTING",
  SCAN_QR_CODE: "SCAN_QR",
  WORKING: "WORKING",
  FAILED: "FAILED",
};

type WahaSession = {
  status?: string;
  me?: { id?: string; pushName?: string } | null;
  config?: { webhooks?: { url?: string; events?: string[] }[] };
};

async function getSession(): Promise<{ state: SessionState; data?: WahaSession }> {
  const r = await waha(`/api/sessions/${SESSION}`);
  if (r.status === 404) return { state: "NOT_CREATED" };
  if (!r.ok) throw new Error(`Waha GET sessão: HTTP ${r.status}`);
  const data = (await r.json()) as WahaSession;
  return { state: STATUS_MAP[data.status ?? ""] ?? "FAILED", data };
}

function toStatus(state: SessionState, data?: WahaSession): SessionStatus {
  return {
    state,
    phone: data?.me?.id?.replace(/@.*/, ""),
    verifiedName: data?.me?.pushName,
  };
}

type WahaWebhook = {
  event?: string;
  session?: string;
  payload?: {
    id?: string;
    from?: string;
    to?: string;
    fromMe?: boolean;
    body?: string;
    hasMedia?: boolean;
    timestamp?: number;
    notifyName?: string;
    media?: { mimetype?: string; data?: string; seconds?: number } | null;
    _data?: { notifyName?: string; pushName?: string; Info?: { PushName?: string } };
  };
};

export const wahaAdapter: ChannelAdapter = {
  id: "waha",
  label: "WhatsApp pelo QR code",
  hasServiceWindow: false,
  configured: () => Boolean(process.env.WAHA_API_KEY && process.env.WAHA_HMAC_KEY),

  async getSessionStatus(): Promise<SessionStatus> {
    if (!this.configured()) return { state: "NOT_CONFIGURED", detail: "WAHA_API_KEY/WAHA_HMAC_KEY ausentes" };
    if (!(await base())) {
      return { state: "NOT_CONFIGURED", detail: "Servidor do WhatsApp (QR) desligado: inicie o gateway no PC." };
    }
    try {
      const { state, data } = await getSession();
      // Sincroniza o número conectado (troca de número esconde as conversas antigas).
      // FAILED/inacessível não mexe: pode ser só o PC fora do ar.
      if (state === "WORKING" && data?.me?.id) await setWahaLine(data.me.id).catch(() => {});
      if (state === "STOPPED" || state === "NOT_CREATED") await setWahaLine(null).catch(() => {});
      return toStatus(state, data);
    } catch (err) {
      return { state: "FAILED", detail: `Servidor do WhatsApp (QR) inacessível — o PC está ligado? (${String(err)})` };
    }
  },

  async ensureSession(): Promise<SessionStatus> {
    if (!this.configured() || !(await base())) return this.getSessionStatus();
    const started = Date.now();
    const before = await getSession();
    let action = "ignored";

    // 1. Cria ou atualiza config (webhook URL/HMAC podem mudar entre deploys)
    const hook = before.data?.config?.webhooks?.[0];
    const want = sessionConfig().webhooks[0];
    const configStale = hook?.url !== want.url || hook?.events?.join() !== want.events.join();
    if (before.state === "NOT_CREATED") {
      const r = await waha("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ name: SESSION, start: false, config: sessionConfig() }),
      });
      const v = await classify(r);
      if (v === "error") throw new Error(`Waha criar sessão: HTTP ${r.status}`);
      action = "created";
    }
    if (before.state !== "NOT_CREATED" && configStale) {
      const r = await waha(`/api/sessions/${SESSION}`, {
        method: "PUT",
        body: JSON.stringify({ name: SESSION, config: sessionConfig() }),
      });
      if ((await classify(r)) === "error") throw new Error(`Waha atualizar sessão: HTTP ${r.status}`);
      action = "updated";
    }

    // 2. Start condicional — nunca start cego
    const mid = await getSession();
    if (["STOPPED", "FAILED", "NOT_CREATED"].includes(mid.state)) {
      const r = await waha(`/api/sessions/${SESSION}/start`, { method: "POST" });
      if ((await classify(r)) === "error") throw new Error(`Waha iniciar sessão: HTTP ${r.status}`);
      action = action === "ignored" ? "started" : `${action}+started`;
    }

    // 3. Re-GET: fonte da verdade
    const after = await getSession();
    logEvent("session.ensure", {
      channel: "waha",
      stateBefore: before.state,
      stateAfter: after.state,
      action,
      durationMs: Date.now() - started,
    });
    return toStatus(after.state, after.data);
  },

  async getQrCode() {
    const { state } = await getSession();
    if (state !== "SCAN_QR") return null;
    const r = await waha(`/api/${SESSION}/auth/qr?format=image`);
    if (!r.ok) return null;
    const body = (await r.json()) as { mimetype?: string; data?: string };
    return body.data ? { mimetype: body.mimetype ?? "image/png", data: body.data } : null;
  },

  async logout() {
    const r = await waha(`/api/sessions/${SESSION}/logout`, { method: "POST" });
    if ((await classify(r)) === "error") throw new Error(`Waha logout: HTTP ${r.status}`);
  },

  parseWebhook(rawBody: string): ChannelMessage[] {
    const body = JSON.parse(rawBody) as WahaWebhook;
    const p = body.payload;
    if (body.event !== "message" || !p?.id) return [];
    // fromMe = atendente escrevendo pelo celular/WhatsApp Web do número: o cliente é o `to`
    const customer = p.fromMe ? p.to : p.from;
    // Ignora grupos, status e canais: o agente atende só conversas 1-a-1
    if (!customer || !/@(c\.us|lid|s\.whatsapp\.net)$/.test(customer)) return [];
    const text = p.body?.trim() || (p.hasMedia ? "[mídia]" : "");
    if (!text) return [];
    return [
      {
        channel: "waha",
        externalId: customer,
        // Número do bot: quem recebeu (cliente→bot) ou quem enviou (atendente pelo celular)
        line: canonicalPhone(p.fromMe ? p.from : p.to) || undefined,
        fromOperator: Boolean(p.fromMe),
        contactName: p.fromMe ? undefined : (p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? p._data?.Info?.PushName),
        text,
        // Dedup pelo id da msg no WhatsApp (último segmento): a mesma msg pode ser
        // reentregue com outro remetente (@lid em vez do número), e o prefixo muda.
        providerMsgId: `waha:${p.id.split("_").pop()}`,
        receivedAt: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : new Date().toISOString(),
        audio:
          p.media?.data && p.media.mimetype?.startsWith("audio/")
            ? { mimetype: p.media.mimetype, data: p.media.data, seconds: p.media.seconds }
            : undefined,
      },
    ];
  },

  async sendText(to: string, text: string) {
    const r = await waha("/api/sendText", {
      method: "POST",
      body: JSON.stringify({ session: SESSION, chatId: toChatId(to), text: text.slice(0, 4096), linkPreview: true }),
    });
    if (!r.ok) throw new Error(`Waha sendText: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const body = (await r.json().catch(() => ({}))) as { id?: string | { _serialized?: string } };
    const id = typeof body.id === "string" ? body.id : body.id?._serialized;
    return { providerMsgId: id ? `waha:${id.split("_").pop()}` : undefined }; // mesmo formato do dedup
  },

  async markRead(_providerMsgId: string, externalId: string) {
    await waha("/api/sendSeen", {
      method: "POST",
      body: JSON.stringify({ session: SESSION, chatId: toChatId(externalId) }),
    });
  },
};
