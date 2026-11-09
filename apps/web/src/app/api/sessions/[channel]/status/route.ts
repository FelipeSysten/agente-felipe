import { cookies } from "next/headers";
import { getAdapter } from "@/lib/channels/registry";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { adminEmails } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Polling do onboarding (a cada 2s): estado SEMPRE do GET no provedor,
 * e o QR (base64) quando a sessão está aguardando leitura.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[channel]/status">) {
  const email = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!email || !adminEmails().includes(email)) return new Response("unauthorized", { status: 401 });

  const { channel } = await ctx.params;
  let adapter;
  try {
    adapter = getAdapter(channel);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const status = await adapter.getSessionStatus();
  const qr = status.state === "SCAN_QR" ? await adapter.getQrCode?.().catch(() => null) : null;
  return Response.json({ ...status, qr: qr ? `data:${qr.mimetype};base64,${qr.data}` : null });
}
