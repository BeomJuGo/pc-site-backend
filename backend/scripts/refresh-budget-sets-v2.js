import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { buildCompatibleSetWithAIV2 } from "../routes/recommend.js";
import logger from "../utils/logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BUDGETS = Array.from({ length: 16 }, (_, i) => 500000 + i * 100000);
const BRAND_COMBOS = [["amd","nvidia"],["amd","amd"],["intel","nvidia"],["intel","amd"]];

await connectDB();
const db = getDB();

logger.info(`V2 AI 견적 캐시 갱신 시작: ${BUDGETS.length}개 예산 × ${BRAND_COMBOS.length}개 조합 = ${BUDGETS.length * BRAND_COMBOS.length}개`);

let success = 0, fail = 0;

for (const [cpuBrand, gpuBrand] of BRAND_COMBOS) {
  logger.info(`[${cpuBrand.toUpperCase()} + ${gpuBrand.toUpperCase()}] 조합 시작`);
  let prevFloor = {};

  for (const budget of BUDGETS) {
    try {
      const result = await buildCompatibleSetWithAIV2(budget, db, cpuBrand, gpuBrand, prevFloor);

      // 다음 예산 구간을 위한 단조 증가 기준 업데이트
      const meta = result._meta || {};
      prevFloor = {
        minCpuScore:      meta.cpuScore      || 0,
        prevCpuComboPrice: meta.cpuComboPrice || 0,
        minGpuScore:      meta.gpuScore      || 0,
        prevGpuPrice:     meta.gpuPrice      || 0,
      };

      // _meta는 저장하지 않음 (내부 체이닝 전용)
      const { _meta, ...resultToSave } = result;

      const _id = `budget-set-v2:${budget}:${cpuBrand}:${gpuBrand}`;
      await db.collection("cached_sets_v2").replaceOne(
        { _id },
        { _id, budget, cpuBrand, gpuBrand, result: resultToSave, computedAt: new Date() },
        { upsert: true }
      );
      logger.info(`완료: ${budget.toLocaleString()}원 [${cpuBrand}+${gpuBrand}] → ${result.totalPrice?.toLocaleString()}원`);
      success++;
    } catch (err) {
      logger.error(`실패: ${budget.toLocaleString()}원 [${cpuBrand}+${gpuBrand}] — ${err.message}`);
      fail++;
    }
    await sleep(2000);
  }
}

logger.info(`V2 갱신 완료: 성공 ${success}개, 실패 ${fail}개`);
process.exit(fail > 0 && success === 0 ? 1 : 0);
