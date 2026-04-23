import express from "express";
import { getDB } from "../db.js";
import { searchNaverShopping } from "../utils/naverShopping.js";
import { validateNaverPrice } from "../utils/priceValidator.js";
import logger from "../utils/logger.js";

const router = express.Router();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAVER_DELAY_MS = 350;

export async function runDailyPriceUpdate() {
  const db = getDB();
  const col = db.collection("parts");
  const parts = await col.find({}, { projection: { name: 1, category: 1, price: 1 } }).toArray();

  const today = new Date().toISOString().slice(0, 10);
  let updated = 0, skipped = 0, failed = 0;

  logger.info(`Daily Price Update 시작: ${parts.length}개 부품`);

  for (const part of parts) {
    try {
      const naverData = await searchNaverShopping(part.name, 20);
      const rawItems = naverData?.items ?? [];
      const validation = validateNaverPrice(part.name, rawItems, part.price || null);

      if (!validation.valid || !validation.price) {
        logger.warn(`가격 검증 실패 [${part.category}/${part.name}]: ${validation.reason}`);
        skipped++;
        await sleep(NAVER_DELAY_MS);
        continue;
      }

      const newPrice = validation.price;

      await col.updateOne({ _id: part._id }, { $set: { price: newPrice, updatedAt: new Date() } });
      // 오늘 날짜 이력이 없을 때만 priceHistory에 추가
      await col.updateOne(
        { _id: part._id, "priceHistory.date": { $ne: today } },
        { $push: { priceHistory: { $each: [{ date: today, price: newPrice }], $slice: -90 } } }
      );

      logger.info(`[${part.category}] ${part.name}: ${newPrice.toLocaleString()}원`);
      updated++;
    } catch (err) {
      logger.error(`가격 업데이트 실패 [${part.name}]: ${err.message}`);
      failed++;
    }
    await sleep(NAVER_DELAY_MS);
  }

  logger.info(`Daily Price Update 완료 — 업데이트 ${updated}개, 스킵 ${skipped}개, 실패 ${failed}개 / 전체 ${parts.length}개`);
  return { total: parts.length, updated, skipped, failed };
}

// POST /api/admin/update-prices
router.post("/update-prices", async (req, res) => {
  res.json({ status: "started", message: "Daily Price Update 시작됨" });
  setImmediate(async () => {
    try {
      await runDailyPriceUpdate();
    } catch (err) {
      logger.error(`Daily Price Update 실패: ${err.message}`);
    }
  });
});

export default router;
