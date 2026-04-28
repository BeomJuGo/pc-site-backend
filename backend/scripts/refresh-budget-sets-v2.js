import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { buildCompatibleSetWithAIV2 } from "../routes/recommend.js";
import logger from "../utils/logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BUDGETS = Array.from({ length: 16 }, (_, i) => 500000 + i * 100000);

await connectDB();
const db = getDB();

logger.info(`V2 AI 견적 캐시 갱신 시작: ${BUDGETS.length}개 예산`);

let success = 0, fail = 0;

for (const budget of BUDGETS) {
  try {
    const result = await buildCompatibleSetWithAIV2(budget, db);
    const _id = `budget-set-v2:${budget}`;
    await db.collection("cached_sets_v2").replaceOne(
      { _id },
      { _id, budget, result, computedAt: new Date() },
      { upsert: true }
    );
    logger.info(`완료: ${budget.toLocaleString()}원 → ${result.totalPrice?.toLocaleString()}원`);
    success++;
  } catch (err) {
    logger.error(`실패: ${budget.toLocaleString()}원 — ${err.message}`);
    fail++;
  }
  await sleep(2000);
}

logger.info(`V2 갱신 완료: 성공 ${success}개, 실패 ${fail}개`);
process.exit(fail > 0 && success === 0 ? 1 : 0);
