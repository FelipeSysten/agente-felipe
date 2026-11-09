import "server-only";
import { getRedis } from "@/lib/redis";
import { logError, logEvent } from "@/lib/log";
import { flushConversation } from "@/lib/flush";
import type { ChannelMessage } from "@/lib/channels/types";

const PREFIX = process.env.DEBOUNCE_KEY_PREFIX ?? "debounce";
const MAX_BUF = Number(process.env.DEBOUNCE_MAX_BUFFER ?? 20);

interface Buffered {
  conversationId: string;
  msg: ChannelMessage;
}

// Compare-and-drain atômico: só quem ainda detém o token esvazia o buffer.
const DRAIN_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur ~= ARGV[1] then
  if cur then return {'superseded'} end
  return {'lock_expired'}
end
local items = redis.call('LRANGE', KEYS[2], 0, -1)
redis.call('DEL', KEYS[1], KEYS[2])
table.insert(items, 1, 'ok')
return items
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sliding window por (canal, contato). Na Vercel não há processo longo:
 * a rota chama isto dentro de `after()`, que segura a função viva durante a
 * janela. Cada msg nova troca o token do lock; só a última invocação drena.
 */
export async function debounceAndFlush(
  conversationId: string,
  msg: ChannelMessage,
  windowMs: number,
): Promise<void> {
  const key = `${PREFIX}:${msg.channel}:${msg.externalId}`;
  const lock = `${key}:lock`;
  const token = crypto.randomUUID();

  try {
    const redis = getRedis();
    await redis
      .multi()
      .rpush(key, JSON.stringify({ conversationId, msg } satisfies Buffered))
      .ltrim(key, -MAX_BUF, -1)
      .pexpire(key, windowMs * 4)
      // TTL do lock = 4× janela: maior que o timer, senão o flush nunca roda (§0.9.23)
      .set(lock, token, { px: windowMs * 4 })
      .exec();
    logEvent("debounce.enqueued", { conversationId, windowMs });

    await sleep(windowMs);

    const res = (await redis.eval(DRAIN_SCRIPT, [lock, key], [token])) as unknown[];
    const [status, ...items] = res ?? [];
    if (status !== "ok") {
      logEvent(`debounce.${String(status)}`, { conversationId });
      return;
    }
    // Upstash pode desserializar JSON automaticamente — aceitar string ou objeto
    const buffered = items.map((i) => (typeof i === "string" ? JSON.parse(i) : i) as Buffered);
    logEvent("debounce.flushed", { conversationId, count: buffered.length });
    if (buffered.length) await flushConversation(conversationId, buffered.map((b) => b.msg));
  } catch (err) {
    // Redis caiu: perde o debounce mas garante resposta (§0.9.25)
    logError("debounce.redis_failed", err, { conversationId });
    await flushConversation(conversationId, [msg]);
  }
}
