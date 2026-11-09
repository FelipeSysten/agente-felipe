import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";

/**
 * O gateway do PC chama isto ao abrir o túnel (a URL muda a cada reinício).
 * Autenticado com a mesma WAHA_API_KEY que o app usa para falar com o gateway.
 */
export async function POST(req: Request) {
  const key = process.env.WAHA_API_KEY ?? "";
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  const want = Buffer.from(key);
  if (!key || given.length !== want.length || !timingSafeEqual(given, want)) {
    logEvent("waha.register_denied");
    return new Response("unauthorized", { status: 401 });
  }

  const body = z.object({ baseUrl: z.url().startsWith("https://") }).safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response("baseUrl https obrigatória", { status: 400 });

  const baseUrl = body.data.baseUrl.replace(/\/$/, "");
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", wahaBaseUrl: baseUrl, wahaBaseUrlAt: new Date() },
    update: { wahaBaseUrl: baseUrl, wahaBaseUrlAt: new Date() },
  });
  logEvent("waha.registered", { host: new URL(baseUrl).host });
  return Response.json({ ok: true });
}
