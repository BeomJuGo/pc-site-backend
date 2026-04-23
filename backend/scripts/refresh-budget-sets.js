import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { buildCompatibleSetWithAI, saveBudgetSetToDb } from "../routes/recommend.js";
import logger from "../utils/logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PURPOSES = ["게임용", "작업용"];
const BUDGETS = Array.from({ length: 26 }, (_, i) => 500000 + i * 100000);

await connectDB();
const db = getDB();

logger.info(`AI 추천 캐시 갱신 시작: ${PURPOSES.length}개 용도 × ${BUDGETS.length}개 예산 = ${PURPOSES.length * BUDGETS.length}개`);

let success = 0, fail = 0;

for (const purpose of PURPOSES) {
  for (const budget of BUDGETS) {
    try {
      const result = await buildCompatibleSetWithAI(budget, purpose, db);
      await saveBudgetSetToDb(db, budget, purpose, result);
      logger.info(`완료: ${budget.toLocaleString()}원 / ${purpose} → ${result.totalPrice?.toLocaleString()}원`);
      success++;
    } catch (err) {
      logger.error(`실패: ${budget.toLocaleString()}원 / ${purpose} — ${err.message}`);
      fail++;
    }
    await sleep(2000);
  }
}

logger.info(`갱신 완료: 성공 ${success}개, 실패 ${fail}개`);
process.exit(fail > 0 && success === 0 ? 1 : 0);
