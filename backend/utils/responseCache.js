import { LRUCache } from "lru-cache";
import logger from "./logger.js";

const lru = new LRUCache({ max: 1000, ttl: 5 * 60 * 1000 });
let redis = null;

export async function connectRedisCache() {
  const url = process.env.REDIS_URL;
  if (!url) return;
  try {
    const { createClient } = await import("redis");
    redis = createClient({
      url,
      socket: { reconnectStrategy: (n) => Math.min(n * 200, 10000) },
    });
    redis.on("error", (e) => logger.error(`Redis 에러: ${e.message}`));
    await redis.connect();
    logger.info("Redis 캐시 연결 완료");
  } catch (e) {
    logger.warn(`Redis 연결 실패 (LRU 폴백): ${e.message}`);
    redis = null;
  }
}

export async function getCache(key) {
  const lruHit = lru.get(key);
  if (lruHit !== undefined) return lruHit;

  if (redis?.isReady) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const val = JSON.parse(raw);
        lru.set(key, val);
        return val;
      }
    } catch (e) {
      logger.error(`Redis GET 실패 (${key}): ${e.message}`);
    }
  }
  return null;
}

export function setCache(key, value, ttlMs = 5 * 60 * 1000) {
  lru.set(key, value, { ttl: ttlMs });
  if (redis?.isReady) {
    redis
      .set(key, JSON.stringify(value), { PX: ttlMs })
      .catch((e) => logger.error(`Redis SET 실패 (${key}): ${e.message}`));
  }
}

export function invalidatePrefix(prefix) {
  for (const key of lru.keys()) {
    if (key.startsWith(prefix)) lru.delete(key);
  }
  if (redis?.isReady) {
    redis
      .keys(`${prefix}*`)
      .then((keys) => keys.length && redis.del(keys))
      .catch(() => {});
  }
}

export function getRedisClient() {
  return redis;
}
