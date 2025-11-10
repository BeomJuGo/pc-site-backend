// db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/pcsite";
console.log("🔗 MongoDB URI:", mongoUri ? "설정됨" : "설정되지 않음");

const client = new MongoClient(mongoUri);

let db;
export async function connectDB() {
  await client.connect();
  
  // URI에서 데이터베이스 이름 추출
  const url = new URL(mongoUri);
  const dbName = url.pathname.substring(1) || "pcsite"; // /pcsite -> pcsite
  console.log("📊 사용할 데이터베이스:", dbName);
  
  db = client.db(dbName);
  console.log("✅ MongoDB 연결 완료");
}

export function getDB() {
  return db;
}
