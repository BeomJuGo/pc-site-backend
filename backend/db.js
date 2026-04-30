import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import logger from "./utils/logger.js";
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/pcsite";

const client = new MongoClient(mongoUri, {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
});

let db;

async function ensureIndexes(database) {
  const parts = database.collection("parts");
  await parts.createIndex({ category: 1 });
  await parts.createIndex({ category: 1, name: 1 });
  await parts.createIndex({ category: 1, price: 1 });
  await parts.createIndex({ name: "text" }, { default_language: "none" });
  // value-rank 정렬용: 내림차순
  await parts.createIndex({ category: 1, "benchmarkScore.passmarkscore": -1 });
  await parts.createIndex({ category: 1, "benchmarkScore.3dmarkscore": -1 });
  await parts.createIndex({ category: 1, "naverData.reviewCount": -1 });

  const builds = database.collection("builds");
  await builds.createIndex({ shareId: 1 }, { unique: true });
  await builds.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const alerts = database.collection("price_alerts");
  await alerts.createIndex({ email: 1 });
  await alerts.createIndex({ triggered: 1 });
  await alerts.createIndex({ category: 1, name: 1, email: 1, triggered: 1 });

  // AI 추천 캐시 TTL 인덱스 (24시간 후 자동 삭제)
  const aiRecs = database.collection("ai_recommendations");
  await aiRecs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
}

export async function connectDB() {
  await client.connect();

  const url = new URL(mongoUri);
  const dbName = url.pathname.substring(1) || "pcsite";

  db = client.db(dbName);
  await ensureIndexes(db);
  logger.info(`MongoDB 연결 완료 (DB: ${dbName})`);
}

export function getDB() {
  return db;
}
