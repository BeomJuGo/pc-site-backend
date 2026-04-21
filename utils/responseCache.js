import { LRUCache } from "lru-cache";

const cache = new LRUCache({
  max: 200,
  ttl: 5 * 60 * 1000, // 5분 기본 TTL
});

export function getCache(key) {
  return cache.get(key);
}

export function setCache(key, value, ttlMs) {
  cache.set(key, value, ttlMs ? { ttl: ttlMs } : undefined);
}

export function invalidatePrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
