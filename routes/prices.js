// routes/prices.js - 멀티몰 가격 비교 (Phase 4)
import express from "express";
import { getDB } from "../db.js";
import { getCache, setCache } from "../utils/responseCache.js";
import { setCacheHeaders } from "../middleware/httpCache.js";
import { validate } from "../middleware/validate.js";
import { searchNaverShopping, parseNaverItems } from "../utils/naverShopping.js";
import { priceCheckSchema } from "../schemas/parts.js";
import logger from "../utils/logger.js";

const router = express.Router();

const CACHE_TTL = 60 * 60 * 1000; // 1시간

async function getPriceData(category, name) {
  const cacheKey = `prices:${category}:${name}`;
  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, _fromCache: true };

  const db = getDB();
  const [stored, naverData] = await Promise.all([
    db.collection("parts").findOne(
      { category, name },
      { projection: { name: 1, price: 1, updatedAt: 1, category: 1 } }
    ),
    searchNaverShopping(name, 20),
  ]);

  const naverMalls = parseNaverItems(naverData);
  const lowestNaver = naverMalls[0]?.price ?? null;
  const lowestMall = naverMalls[0]?.mallName ?? null;

  const result = {
    name: stored?.name || name,
    category,
    storedPrice: stored?.price ?? null,
    lastUpdated: stored?.updatedAt ?? null,
    naverMalls: naverMalls.slice(0, 10),
    lowestPrice: lowestNaver,
    lowestMall,
    priceGap: stored?.price && lowestNaver != null ? stored.price - lowestNaver : null,
    inStock: naverMalls.length > 0,
    mallCount: naverMalls.length,
    checkedAt: new Date().toISOString(),
  };

  setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// GET /api/prices/:category/:name - 단일 부품 멀티몰 가격 비교
router.get("/:category/:name", setCacheHeaders(300), async (req, res) => {
  const { category, name } = req.params;
  const decoded = decodeURIComponent(name);
  try {
    const result = await getPriceData(category, decoded);
    res.json(result);
  } catch (err) {
    logger.error(`가격 비교 실패: ${err.message}`);
    res.status(500).json({ error: "가격 비교 실패" });
  }
});

// POST /api/prices/batch - 빌드 전체 가격 일괄 조회
router.post("/batch", validate(priceCheckSchema), async (req, res) => {
  const { parts } = req.body;
  try {
    const results = await Promise.all(
      parts.map(({ category, name }) => getPriceData(category, name))
    );

    const totalLowest = results.reduce((s, r) => s + (r.lowestPrice || 0), 0);
    const totalStored = results.reduce((s, r) => s + (r.storedPrice || 0), 0);
    const allInStock = results.every((r) => r.inStock);

    res.json({
      parts: results,
      summary: {
        totalLowest,
        totalStored,
        saving: totalStored > 0 && totalLowest > 0 ? totalStored - totalLowest : null,
        allInStock,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(`일괄 가격 체크 실패: ${err.message}`);
    res.status(500).json({ error: "일괄 가격 체크 실패" });
  }
});

export default router;
