import express from "express";
import { getDB } from "../db.js";
import { fetchNaverPrice } from "../utils/priceResolver.js";
import { fetchAllBrandWeights } from "../utils/naverDatalab.js";
import { invalidatePrefix } from "../utils/responseCache.js";
import { callGptInfo } from "../utils/gptInfo.js";
import logger from "../utils/logger.js";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== DB 정리 ==================== */

router.post("/cleanup-db", async (req, res) => {
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const results = {};

  // 1. 가성비 cached_sets 삭제
  const r1 = await db.collection("cached_sets").deleteMany({ _id: { $regex: "가성비" } });
  results.deleted_gasungbi_sets = r1.deletedCount;

  // 2. 노트북 메모리 삭제
  const r2 = await db.collection("parts").deleteMany({
    category: "memory",
    name: { $regex: "노트북|SO-DIMM|SODIMM|소딤|notebook|laptop", $options: "i" },
  });
  results.deleted_laptop_memory = r2.deletedCount;

  // 3. 90일 이전 priceHistory 항목 $pull로 삭제 (string 날짜 비교)
  const r3 = await db.collection("parts").updateMany(
    { "priceHistory.date": { $lt: cutoff } },
    { $pull: { priceHistory: { date: { $lt: cutoff } } } }
  );
  results.trimmed_price_history = r3.modifiedCount;
  results.price_history_cutoff = cutoff;

  // 4. 중복 부품 삭제 (같은 name + category, 첫 번째 _id만 보존)
  const dupeGroups = await db.collection("parts").aggregate([
    { $group: { _id: { name: "$name", category: "$category" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  let deletedDuplicates = 0;
  for (const group of dupeGroups) {
    const toDelete = group.ids.slice(1);
    const r = await db.collection("parts").deleteMany({ _id: { $in: toDelete } });
    deletedDuplicates += r.deletedCount;
  }
  results.deleted_duplicates = deletedDuplicates;
  results.duplicate_groups_found = dupeGroups.length;

  logger.info(`cleanup-db 완료: ${JSON.stringify(results)}`);
  res.json({ status: "ok", ...results });
});

/* ==================== 가격 0원/미등록 부품 일괄 삭제 ==================== */

router.post("/delete-zero-price", async (req, res) => {
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const result = await db.collection("parts").deleteMany({
    $or: [
      { price: { $exists: false } },
      { price: null },
      { price: { $lte: 0 } },
    ],
  });

  logger.info(`delete-zero-price 완료: ${result.deletedCount}개 삭제`);
  res.json({ status: "ok", deleted: result.deletedCount });
});

/* ==================== priceHistory 전체 초기화 + 오늘 가격으로 재설정 ==================== */

router.post("/reset-price-history", async (req, res) => {
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const today = new Date().toISOString().slice(0, 10);

  // 모든 priceHistory 배열을 비우고, price > 0인 경우 오늘 가격 1개만 남김
  const r = await db.collection("parts").updateMany(
    {},
    [{ $set: { priceHistory: { $cond: [{ $gt: ["$price", 0] }, [{ date: today, price: "$price" }], []] } } }]
  );

  logger.info(`reset-price-history 완료: ${r.modifiedCount}개 부품 초기화`);
  res.json({ status: "ok", reset: r.modifiedCount, today });
});

/* ==================== 모든 부품 가격을 네이버쇼핑 API로 업데이트 ==================== */

router.post("/update-all-prices", async (req, res) => {
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const category = req.body?.category || null;
  const filter = category ? { category } : {};
  const parts = await db.collection("parts").find(filter, { projection: { _id: 1, name: 1, category: 1, price: 1 } }).toArray();

  res.json({ status: "started", total: parts.length, category: category || "전체" });

  setImmediate(async () => {
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
    logger.info(`update-all-prices 완료: 성공 ${updated}개, 건너뜀 ${skipped}개, 실패 ${failed}개 (총 ${parts.length}개)`);
    invalidatePrefix("prices:");
    logger.info("prices: 캐시 무효화 완료");
  });
});

/* ==================== 모든 부품 spec + 한줄평 GPT-5.4 재생성 ==================== */

router.post("/update-all-specs", async (req, res) => {
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const category = req.body?.category || null;
  const overwrite = req.body?.overwrite === true; // 기존 데이터 덮어쓰기 여부
  const filter = category ? { category } : {};
  const parts = await db.collection("parts").find(filter, { projection: { _id: 1, name: 1, category: 1, review: 1, specSummary: 1 } }).toArray();

  res.json({ status: "started", total: parts.length, category: category || "전체", overwrite });

  setImmediate(async () => {
    let updated = 0, skipped = 0, failed = 0;
    for (const part of parts) {
      // overwrite 옵션이 없으면 이미 review + specSummary 있는 부품은 건너뜀
      if (!overwrite && part.review && part.specSummary) {
        skipped++;
        continue;
      }
      try {
        const { review, specSummary } = await callGptInfo(
          part.name,
          part.category,
          "gpt-5.4",
          OPENAI_API_KEY
        );
        if (review && specSummary) {
          await db.collection("parts").updateOne(
            { _id: part._id },
            { $set: { review, specSummary, specUpdatedAt: new Date().toISOString() } }
          );
          updated++;
        }
      } catch (err) {
        logger.error(`spec 업데이트 실패: ${part.name} — ${err.message}`);
        failed++;
      }
      await sleep(400);
    }
    logger.info(`update-all-specs 완료: 성공 ${updated}개, 건너뜀 ${skipped}개, 실패 ${failed}개 (총 ${parts.length}개)`);
  });
});

/* ==================== 가격 캐시 즉시 무효화 ==================== */

router.post("/clear-prices-cache", (req, res) => {
  invalidatePrefix("prices:");
  logger.info("prices: 캐시 수동 무효화 완료");
  res.json({ status: "ok", message: "prices: 캐시가 모두 삭제되었습니다" });
});

/* ==================== 브랜드 인기도 가중치 업데이트 (Naver DataLab) ==================== */

router.post("/update-brand-weights", async (req, res) => {
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  res.json({ status: "started", message: "DataLab 브랜드 가중치 수집 중 (6개 카테고리 × 최근 3개월)" });

  setImmediate(async () => {
    try {
      const weights = await fetchAllBrandWeights();
      const now = new Date();
      for (const [category, brandScores] of Object.entries(weights)) {
        await db.collection("brand_weights").replaceOne(
          { _id: category },
          { _id: category, category, weights: brandScores, updatedAt: now },
          { upsert: true }
        );
      }
      logger.info(`update-brand-weights 완료: ${Object.keys(weights).length}개 카테고리 저장`);
    } catch (err) {
      logger.error(`update-brand-weights 실패: ${err.message}`);
    }
  });
});

export default router;
