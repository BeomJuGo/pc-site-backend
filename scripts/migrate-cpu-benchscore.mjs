// 기존 CPU의 benchScore (최상위) → benchmarkScore.passmarkscore 마이그레이션
import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "fs";

if (existsSync(".env")) {
  const lines = readFileSync(".env", "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error("❌ MONGODB_URI 없음"); process.exit(1); }

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db(new URL(MONGODB_URI).pathname.substring(1) || "pcsite");
const col = db.collection("parts");

const result = await col.updateMany(
  { category: "cpu", benchScore: { $exists: true, $gt: 0 } },
  [{ $set: { benchmarkScore: { passmarkscore: "$benchScore" } } }]
);

console.log(`✅ 마이그레이션 완료: ${result.modifiedCount}개 CPU 업데이트`);
await client.close();
