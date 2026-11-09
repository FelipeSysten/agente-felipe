import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logEvent } from "@/lib/log";
import { canonicalPhone } from "@/lib/phone";
import type { ChannelAdapter, ChannelMessage, SessionStatus } from "./types";

// META_GRAPH_BASE_URL só existe p/ testes locais contra um mock da Graph API.
const GRAPH = `${process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com"}/${process.env.META_GRAPH_VERSION ?? "v24.0"}`;

export class MetaApiError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

function env() {
  return {
    phoneNumberId: process.env.META_PHONE_NUMBER_ID,
    wabaId: process.env.META_BUSINESS_ACCOUNT_ID,
    token: process.env.META_SYSTEM_USER_TOKEN,
    appId: process.env.META_APP_ID,
  };
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env().token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { code?: number; message?: string } }).error;
    throw new MetaApiError(res.status, err?.code, err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

/** HMAC-SHA256 do raw body com META_APP_SECRET (header X-Hub-Signature-256). */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type WebhookPayload = {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          timestamp?: string;
          type: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }[];
      };
    }[];
  }[];
};

const MEDIA_PLACEHOLDER: Record<string, string> = {
  image: "[o cliente enviou uma imagem]",
  audio: "[o cliente enviou um áudio]",
  video: "[o cliente enviou um vídeo]",
  document: "[o cliente enviou um documento]",
  sticker: "[o cliente enviou uma figurinha]",
  location: "[o cliente enviou uma localização]",
};

export const whatsappCloudAdapter: ChannelAdapter = {
  id: "whatsapp_cloud",
  label: "API oficial da Meta",
  hasServiceWindow: true,
  configured: () =>
    Boolean(process.env.META_PHONE_NUMBER_ID && process.env.META_BUSINESS_ACCOUNT_ID && process.env.META_SYSTEM_USER_TOKEN),

  async getSessionStatus(): Promise<SessionStatus> {
    const { phoneNumberId, wabaId, token, appId } = env();
    if (!phoneNumberId || !wabaId || !token) {
      return { state: "NOT_CONFIGURED", detail: "Credenciais Meta ausentes nas env vars" };
    }
    try {
      const phone = await graph<{ display_phone_number?: string; verified_name?: string }>(
        `/${phoneNumberId}?fields=display_phone_number,verified_name`,
      );
      const subs = await graph<{ data?: { whatsapp_business_api_data?: { id?: string } }[] }>(
        `/${wabaId}/subscribed_apps`,
      );
      const subscribed = (subs.data ?? []).some(
        (s) => !appId || s.whatsapp_business_api_data?.id === appId,
      );
      return {
        state: subscribed ? "WORKING" : "FAILED",
        detail: subscribed ? undefined : "App não inscrito nos webhooks da WABA",
        phone: phone.display_phone_number,
        verifiedName: phone.verified_name,
        subscribed,
      };
    } catch (err) {
      return { state: "FAILED", detail: String(err) };
    }
  },

  async ensureSession(): Promise<SessionStatus> {
    const before = await this.getSessionStatus();
    if (before.state === "WORKING" || before.state === "NOT_CONFIGURED") return before;
    // Assinatura é feita na WABA (não no phone number). GET antes, POST só se faltar.
    if (before.subscribed === false) {
      await graph(`/${env().wabaId}/subscribed_apps`, { method: "POST" });
    }
    const after = await this.getSessionStatus();
    logEvent("session.state_changed", {
      channel: "whatsapp_cloud",
      before: before.state,
      after: after.state,
    });
    return after;
  },

  parseWebhook(rawBody: string): ChannelMessage[] {
    const payload = JSON.parse(rawBody) as WebhookPayload;
    const out: ChannelMessage[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (change.field !== "messages" || !value?.messages) continue; // ignora statuses
        if (env().phoneNumberId && value.metadata?.phone_number_id !== env().phoneNumberId) {
          continue; // evento de outro número da mesma WABA
        }
        for (const m of value.messages) {
          const text =
            m.text?.body ??
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            MEDIA_PLACEHOLDER[m.type];
          if (!text) continue;
          out.push({
            channel: "whatsapp_cloud",
            externalId: m.from,
            line: canonicalPhone(value.metadata?.display_phone_number) || value.metadata?.phone_number_id,
            contactName: value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name,
            text,
            providerMsgId: m.id,
            receivedAt: m.timestamp
              ? new Date(Number(m.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            audio: m.type === "audio" && m.audio?.id
              ? { mimetype: (m.audio.mime_type ?? "audio/ogg").split(";")[0], mediaId: m.audio.id }
              : undefined,
          });
        }
      }
    }
    return out;
  },

  async sendText(externalId: string, text: string) {
    if (!/^\d{8,15}$/.test(externalId)) {
      // wa_id é só dígitos; um cuid aqui = bug §0.9.27
      throw new Error(`destinatário inválido p/ Cloud API: ${externalId.slice(0, 6)}…`);
    }
    const res = await graph<{ messages?: { id: string }[] }>(
      `/${env().phoneNumberId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: externalId,
          type: "text",
          text: { preview_url: true, body: text.slice(0, 4096) },
        }),
      },
    );
    return { providerMsgId: res.messages?.[0]?.id };
  },

  /** GET /{media-id} → URL temporária → download autenticado. */
  async downloadMedia(mediaId: string) {
    const meta = await graph<{ url?: string; mime_type?: string; file_size?: number }>(`/${mediaId}`);
    if (!meta.url) throw new Error("Meta: mídia sem URL");
    if ((meta.file_size ?? 0) > 20 * 1024 * 1024) throw new Error("Meta: áudio maior que 20 MB");
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${env().token}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Meta: download da mídia HTTP ${res.status}`);
    return {
      mimetype: (meta.mime_type ?? "audio/ogg").split(";")[0],
      data: Buffer.from(await res.arrayBuffer()).toString("base64"),
    };
  },

  async markRead(providerMsgId: string) {
    await graph(`/${env().phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: providerMsgId,
      }),
    });
  },
};
