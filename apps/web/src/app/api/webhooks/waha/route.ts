import { verifyWahaSignature, wahaAdapter } from "@/lib/channels/waha";
import { intake } from "@/lib/intake";
import { logError, logEvent } from "@/lib/log";
import { setWahaLine } from "@/lib/lines";

// Janela de debounce + cadeia de LLMs rodam dentro de after(): precisa de folga.
export const maxDuration = 60;

export async function POST(req: Request) {
  const rawBody = await req.text(); // raw bytes p/ HMAC
  if (!verifyWahaSignature(rawBody, req.headers.get("x-webhook-hmac"))) {
    logEvent("webhook.hmac_invalid", { channel: "waha" });
    return new Response("invalid signature", { status: 401 });
  }

  // Sempre 200 após o HMAC: 5xx faz o Waha reenviar em loop.
  try {
    const event = JSON.parse(rawBody) as { event?: string; payload?: { status?: string }; me?: { id?: string } | null };
    if (event.event === "session.status") {
      const status = event.payload?.status;
      logEvent("session.state_changed", { channel: "waha", after: status });
      // Número conectado mudou → conversas do número anterior somem do painel
      if (status === "WORKING" && event.me?.id) await setWahaLine(event.me.id);
      if (status === "STOPPED") await setWahaLine(null);
      return Response.json({ ok: true });
    }
    const msgs = wahaAdapter.parseWebhook(rawBody);
    if (!msgs.length) return Response.json({ ok: true, ignored: true });
    await intake(msgs);
  } catch (err) {
    logError("webhook.process_failed", err, { channel: "waha" });
  }
  return Response.json({ ok: true });
}
