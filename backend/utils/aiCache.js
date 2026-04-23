import crypto from "crypto";
import { getDB } from "../db.js";
import logger from "./logger.js";

const COLLECTION = "ai_recommendations";
const TTL_MS = 24 * 60 * 60 * 1000; // 24시간

export function makeAiCacheKey(params) {
  return crypto.createHash("sha1").update(JSON.stringify(params)).digest("hex");
}

export async function getOrComputeRecommendation(key, producer) {
  const db = getDB();
  if (!db) return producer();

  try {
    const cached = await db.collection(COLLECTION).findOne({ _id: key });
    if (cached) {
      logger.info(`AI 캐시 히트: ${key}`);
      return cached.data;
    }
  } catch (err) {
    logger.warn(`AI 캐시 조회 실패: ${err.message}`);
  }

  const result = await producer();

  try {
    await db.collection(COLLECTION).replaceOne(
      { _id: key },
      { _id: key, data: result, createdAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    logger.warn(`AI 캐시 저장 실패: ${err.message}`);
  }

  return result;
}
