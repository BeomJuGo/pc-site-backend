import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/pcsite";

const client = new MongoClient(mongoUri);

let db;

async function ensureIndexes(database) {
  const parts = database.collection("parts");
  await parts.createIndex({ category: 1 });
  await parts.createIndex({ category: 1, name: 1 });
  await parts.createIndex({ category: 1, price: 1 });
  await parts.createIndex({ category: 1, "benchmarkScore.passmarkscore": 1 });
  await parts.createIndex({ category: 1, "benchmarkScore.3dmarkscore": 1 });

  const builds = database.collection("builds");
  await builds.createIndex({ shareId: 1 }, { unique: true });
  await builds.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const alerts = database.collection("price_alerts");
  await alerts.createIndex({ email: 1 });
  await alerts.createIndex({ triggered: 1 });
  await alerts.createIndex({ category: 1, name: 1, email: 1, triggered: 1 });
}

export async function connectDB() {
  await client.connect();

  const url = new URL(mongoUri);
  const dbName = url.pathname.substring(1) || "pcsite";

  db = client.db(dbName);
  await ensureIndexes(db);
  console.log(`✅ MongoDB 연결 완료 (DB: ${dbName})`);
}

export function getDB() {
  return db;
}
