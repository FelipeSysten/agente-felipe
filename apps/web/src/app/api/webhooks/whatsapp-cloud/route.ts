import { verifyMetaSignature, whatsappCloudAdapter } from "@/lib/channels/whatsapp-cloud";
import { intake } from "@/lib/intake";
import { logError, logEvent } from "@/lib/log";

// Janela de debounce + cadeia de LLMs rodam dentro de after(): precisa de folga.
export const maxDuration = 60;

/** Handshake de verificação do webhook (Meta App Dashboard). Resposta em texto puro. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text(); // raw bytes p/ HMAC — nunca req.json() antes
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    logEvent("webhook.hmac_invalid", { channel: "whatsapp_cloud" });
    return new Response("invalid signature", { status: 401 });
  }

  // Daqui em diante sempre 200: erro vira log/DLQ, senão a Meta reenvia em loop.
  try {
    const msgs = whatsappCloudAdapter.parseWebhook(rawBody);
    if (!msgs.length) return Response.json({ ok: true, ignored: true });
    await intake(msgs);
  } catch (err) {
    logError("webhook.process_failed", err, { channel: "whatsapp_cloud" });
  }
  return Response.json({ ok: true });
}
