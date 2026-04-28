import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { getPopularityScore } from "../utils/naverDatalab.js";
import logger from "../utils/logger.js";

await connectDB();
const db = getDB();

const brandWeightDocs = await db.collection("brand_weights").find().toArray().catch(() => []);
const brandWeightMap = Object.fromEntries(brandWeightDocs.map((d) => [d.category, d.weights || {}]));
logger.info(`브랜드 가중치 로드: ${Object.keys(brandWeightMap).length}개 카테고리`);

const parts = await db
  .collection("parts")
  .find({}, { projection: { _id: 1, name: 1, category: 1, mallCount: 1 } })
  .toArray();
logger.info(`인기도 점수 계산 시작: ${parts.length}개 부품`);

const bulk = db.collection("parts").initializeUnorderedBulkOp();
for (const part of parts) {
  const score = getPopularityScore(part, part.category, brandWeightMap);
  bulk.find({ _id: part._id }).updateOne({ $set: { popularityScore: score } });
}

if (parts.length > 0) {
  const result = await bulk.execute();
  logger.info(`인기도 점수 업데이트 완료: ${result.modifiedCount}개`);
} else {
  logger.info("업데이트할 부품 없음");
}

process.exit(0);
