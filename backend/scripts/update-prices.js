import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { fetchNaverPrice } from "../utils/priceResolver.js";
import logger from "../utils/logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await connectDB();
const db = getDB();

const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// DB 정리: 90일 이전 가격 이력, 가성비 캐시, 중복 부품
const r1 = await db.collection("cached_sets").deleteMany({ _id: { $regex: "가성비" } });
await db.collection("parts").deleteMany({
  category: "memory",
  name: { $regex: "노트북|SO-DIMM|SODIMM|소딤|notebook|laptop", $options: "i" },
});
await db.collection("parts").updateMany(
  { "priceHistory.date": { $lt: cutoff } },
  { $pull: { priceHistory: { date: { $lt: cutoff } } } }
);
logger.info(`DB 정리 완료 (가성비 캐시 ${r1.deletedCount}개, 90일 이전 이력 삭제)`);

// 가격 업데이트
const parts = await db.collection("parts").find(
  {},
  { projection: { _id: 1, name: 1, category: 1, price: 1 } }
).toArray();

logger.info(`가격 업데이트 시작: ${parts.length}개 부품`);

let updated = 0, skipped = 0, failed = 0;
const today = new Date().toISOString().slice(0, 10);

for (const part of parts) {
  try {
    const { price: naverPrice, mallCount } = await fetchNaverPrice(part.name);
    if (!naverPrice || naverPrice <= 0) {
      skipped++;
      continue;
    }
    const ops = { $set: { price: naverPrice, mallCount: mallCount || 0 } };
    if (naverPrice !== part.price) {
      ops.$push = { priceHistory: { $each: [{ date: today, price: naverPrice }], $slice: -90 } };
    }
    await db.collection("parts").updateOne({ _id: part._id }, ops);
    updated++;
  } catch (err) {
    logger.error(`가격 업데이트 실패: ${part.name} — ${err.message}`);
    failed++;
  }
  await sleep(200);
}

logger.info(`완료: 성공 ${updated}개, 건너뜀 ${skipped}개, 실패 ${failed}개 (총 ${parts.length}개)`);
process.exit(0);
