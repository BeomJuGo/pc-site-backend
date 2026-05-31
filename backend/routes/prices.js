// routes/prices.js - 멀티몰 가격 비교 (Phase 4)
import express from "express";
import { getDB } from "../db.js";
import { getCache, setCache } from "../utils/responseCache.js";
import { setCacheHeaders } from "../middleware/httpCache.js";
import { validate } from "../middleware/validate.js";
import { searchNaverShopping, parseNaverItems } from "../utils/naverShopping.js";
import { validateNaverPrice } from "../utils/priceValidator.js";
import { applyStrictFilters, selectRobustLowest } from "../utils/priceResolver.js";
import { priceCheckSchema } from "../schemas/parts.js";
import logger from "../utils/logger.js";

const router = express.Router();

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6시간 (가격은 일 1회 업데이트, 긴 캐시로 Naver API 콜 최소화)

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getPriceData(category, name) {
  const cacheKey = `prices:${category}:${name}`;
  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, _fromCache: true };

  const db = getDB();
  // 프론트엔드의 cleanName이 괄호 이후를 제거하므로, 정확 매칭 실패 시 prefix 매칭으로 DB 풀네임 조회
  let stored = await db.collection("parts").findOne(
    { category, name },
    { projection: { name: 1, price: 1, updatedAt: 1, category: 1 } }
  );
  if (!stored) {
    stored = await db.collection("parts").findOne(
      { category, name: { $regex: `^${escapeRegex(name)}`, $options: "i" } },
      { projection: { name: 1, price: 1, updatedAt: 1, category: 1 } }
    );
  }
  // DB 풀네임으로 Naver 조회 (정확도 향상)
  const queryName = stored?.name || name;
  const naverData = await searchNaverShopping(queryName, 40, "sim");

  const rawItems = naverData?.items ?? [];
  // 목록 가격과 동일한 강한 5단계 검증 적용 (토큰 + 중고/리퍼 + 브랜드 매칭)
  const parsed = parseNaverItems(naverData);
  const validItems = applyStrictFilters(queryName, parsed);
  const sorted = validItems.slice().sort((a, b) => a.price - b.price);

  // 이상치 제거 후 최저가 결정 (목록 업데이트와 동일 로직)
  const { price: lowestNaver, outlierRemoved } = selectRobustLowest(sorted);
  // 표시용 malls 리스트에서도 이상치로 판정된 아이템들 제거해 일관성 유지
  const displayMalls = sorted.slice(outlierRemoved);
  const lowestNaverMall = displayMalls[0]?.mallName ?? null;
  const validation = validateNaverPrice(queryName, rawItems, stored?.price ?? null);

  // 실시간 Naver 최저가를 우선 사용해 표시 가격과 쇼핑몰 목록이 항상 일치하도록 함.
  // Naver 결과가 없을 때만 DB 저장 가격으로 폴백.
  const lowestPrice = lowestNaver > 0 ? lowestNaver : (stored?.price > 0 ? stored.price : null);
  const lowestMall = lowestNaver > 0 ? lowestNaverMall : null;
  // DB 기록 가격보다 현재 가격이 높으면 priceRise 양수 (가격 상승)
  const priceRise = lowestNaver > 0 && stored?.price > 0 && lowestNaver > stored.price
    ? lowestNaver - stored.price : null;

  const result = {
    name: stored?.name || name,
    category,
    storedPrice: stored?.price ?? null,
    lastUpdated: stored?.updatedAt ?? null,
    naverMalls: displayMalls.slice(0, 20),
    lowestPrice,
    lowestMall,
    priceRise,
    inStock: displayMalls.length > 0,
    mallCount: displayMalls.length,
    validation,
    checkedAt: new Date().toISOString(),
  };

  setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// GET /api/prices/:category/:name - 단일 부품 멀티몰 가격 비교
router.get("/:category/:name", setCacheHeaders(3600, 43200), async (req, res) => {
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
