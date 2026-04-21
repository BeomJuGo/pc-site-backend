// routes/parts.js
import express from "express";
import { getDB } from "../db.js";
import { getCache, setCache } from "../utils/responseCache.js";
import { buildValueRankPipeline, buildBudgetPicksPipeline, BUDGET_RATIOS } from "../utils/aggregations.js";
import { setCacheHeaders } from "../middleware/httpCache.js";
import { validate } from "../middleware/validate.js";
import { valueRankQuerySchema, budgetPicksQuerySchema, batchQuerySchema } from "../schemas/parts.js";

const router = express.Router();

async function findPartByName(db, category, rawName) {
  const decoded = decodeURIComponent(rawName);
  let part = await db.collection("parts").findOne({ category, name: decoded });
  if (part) return part;
  const cleanName = decoded.split("(")[0].trim();
  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  part = await db.collection("parts").findOne({ category, name: { $regex: `^${escaped}`, $options: "i" } });
  if (part) return part;
  return db.collection("parts").findOne({ category, name: { $regex: escaped, $options: "i" } });
}

// GET /api/parts?category=cpu&page=1&limit=50
router.get("/", setCacheHeaders(60), async (req, res) => {
  const { category, page, limit } = req.query;
  try {
    const db = getDB();
    const query = category ? { category } : {};
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 100));
    const skip = (pageNum - 1) * limitNum;
    const [parts, total] = await Promise.all([
      db.collection("parts").find(query).skip(skip).limit(limitNum).toArray(),
      db.collection("parts").countDocuments(query),
    ]);
    res.set("X-Total-Count", String(total));
    res.set("X-Page", String(pageNum));
    res.set("X-Total-Pages", String(Math.ceil(total / limitNum)));
    res.json(parts);
  } catch (err) {
    res.status(500).json({ error: "부품 목록 조회 실패" });
  }
});

// GET /api/parts/value-rank?category=gpu&limit=20
router.get("/value-rank", validate(valueRankQuerySchema, "query"), setCacheHeaders(120), async (req, res) => {
  const { category, limit = 20 } = req.query;
  const cacheKey = `parts:value-rank:${category}:${limit}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const pipeline = buildValueRankPipeline(category, Number(limit));
    const ranked = await db.collection("parts").aggregate(pipeline).toArray();
    setCache(cacheKey, ranked, 5 * 60 * 1000);
    res.json(ranked);
  } catch (err) {
    res.status(500).json({ error: "가성비 순위 조회 실패" });
  }
});

// GET /api/parts/budget-picks?budget=1000000
router.get("/budget-picks", validate(budgetPicksQuerySchema, "query"), setCacheHeaders(120), async (req, res) => {
  const { budget } = req.query;
  const budgetNum = Number(budget);
  const cacheKey = `parts:budget-picks:${budgetNum}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const pipeline = buildBudgetPicksPipeline(budgetNum);
    const [facetResult] = await db.collection("parts").aggregate(pipeline).toArray();

    const budgetAllocation = Object.fromEntries(
      Object.entries(BUDGET_RATIOS).map(([cat, ratio]) => [cat, Math.round(budgetNum * ratio)])
    );

    const result = { budget: budgetNum, budgetAllocation, picks: facetResult };
    setCache(cacheKey, result, 5 * 60 * 1000);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "예산별 추천 조회 실패" });
  }
});

// POST /api/parts/batch
router.post("/batch", validate(batchQuerySchema), async (req, res) => {
  try {
    const { items } = req.body;
    const db = getDB();
    const results = await Promise.all(
      items.map(({ category, name }) =>
        db.collection("parts").findOne({ category, name }, { projection: { priceHistory: 0 } })
      )
    );
    res.json(results.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: "일괄 조회 실패" });
  }
});

// GET /api/parts/danawa-url?name=PART_NAME
router.get("/danawa-url", (req, res) => {
  const { name } = req.query;
  if (!name || typeof name !== "string" || name.trim() === "")
    return res.status(400).json({ error: "name 파라미터가 필요합니다." });
  if (name.length > 200)
    return res.status(400).json({ error: "name이 너무 깁니다." });
  const url = `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(name.trim())}`;
  res.json({ url, name: name.trim() });
});

// 가격 히스토리: GET /api/parts/:category/:name/history
router.get("/:category/:name/history", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json({ name: part.name, category: part.category, priceHistory: part.priceHistory || [] });
  } catch (err) {
    res.status(500).json({ error: "가격 히스토리 조회 실패" });
  }
});

// 상세 정보: GET /api/parts/:category/:name
router.get("/:category/:name", setCacheHeaders(60), async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: "부품 상세 조회 실패" });
  }
});

export default router;
