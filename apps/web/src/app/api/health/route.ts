import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    (async () => (await getRedis().ping()) === "PONG")().catch(() => false),
  ]);
  return Response.json({ ok: db && redis, db, redis }, { status: db && redis ? 200 : 503 });
}
