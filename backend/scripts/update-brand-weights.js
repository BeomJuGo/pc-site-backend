import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { fetchAllBrandWeights } from "../utils/naverDatalab.js";
import logger from "../utils/logger.js";

await connectDB();
const db = getDB();

logger.info("브랜드 가중치 업데이트 시작 (Naver DataLab)");

const weights = await fetchAllBrandWeights();
const now = new Date();

for (const [category, brandScores] of Object.entries(weights)) {
  await db.collection("brand_weights").replaceOne(
    { _id: category },
    { _id: category, category, weights: brandScores, updatedAt: now },
    { upsert: true }
  );
}

logger.info(`완료: ${Object.keys(weights).length}개 카테고리 저장`);
process.exit(0);
