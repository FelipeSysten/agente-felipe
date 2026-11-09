import "server-only";
import { Redis } from "@upstash/redis";
import { logError } from "@/lib/log";

let client: Redis | undefined;

// Lazy: instanciar no top-level quebra o `next build` sem env (§0.9.12).
// Upstash é REST/HTTP — sem conexão persistente, ideal p/ serverless.
export function getRedis(): Redis {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL/TOKEN não configurados");
  client = new Redis({ url, token });
  return client;
}

export async function checkRateLimit(key: string, maxPerMinute = 30): Promise<boolean> {
  try {
    const redis = getRedis();
    const bucket = `rl:${key}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, 60);
    return count <= maxPerMinute;
  } catch {
    return true; // fail-open: rate limit nunca deve derrubar o atendimento
  }
}

export async function pushDlq(item: Record<string, unknown>) {
  try {
    await getRedis().rpush("dlq:llm_flush", JSON.stringify({ ...item, at: Date.now() }));
  } catch (err) {
    logError("dlq.push_failed", err);
  }
}
