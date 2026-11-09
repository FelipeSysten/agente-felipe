import { getEnabledAdapters } from "@/lib/channels/registry";
import { logError, logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron (1×/dia no Hobby): substitui o instrumentation.ts como "boot hook",
 * que não é confiável em serverless. A Vercel envia Authorization: Bearer $CRON_SECRET.
 */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const results: Record<string, string> = {};
  for (const adapter of getEnabledAdapters()) {
    try {
      const s = await adapter.ensureSession();
      results[adapter.id] = s.state;
      logEvent("channel.ensured", { channel: adapter.id, state: s.state });
    } catch (err) {
      results[adapter.id] = "ERROR";
      logError("channel.ensure_failed", err, { channel: adapter.id });
    }
  }
  return Response.json({ ok: true, results });
}
