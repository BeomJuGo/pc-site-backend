// db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/pcsite";
console.log("🔗 MongoDB URI:", mongoUri ? "설정됨" : "설정되지 않음");

const client = new MongoClient(mongoUri);

let db;

async function ensureIndexes(database) {
  const parts = database.collection("parts");
  await parts.createIndex({ category: 1 });
  await parts.createIndex({ category: 1, name: 1 });
  await parts.createIndex({ category: 1, price: 1 });
  console.log("📑 MongoDB 인덱스 생성 완료");
}

export async function connectDB() {
  await client.connect();

  const url = new URL(mongoUri);
  const dbName = url.pathname.substring(1) || "pcsite";
  console.log("📊 사용할 데이터베이스:", dbName);

  db = client.db(dbName);
  await ensureIndexes(db);
  console.log("✅ MongoDB 연결 완료");
}

export function getDB() {
  return db;
}
