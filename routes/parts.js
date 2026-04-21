// routes/parts.js
import express from "express";
import { getDB } from "../db.js";
import { getCache, setCache } from "../utils/responseCache.js";
import { buildValueRankPipeline, buildBudgetPicksPipeline, BUDGET_RATIOS } from "../utils/aggregations.js";
import { setCacheHeaders } from "../middleware/httpCache.js";
import { validate } from "../middleware/validate.js";
import { valueRankQuerySchema, budgetPicksQuerySchema, batchQuerySchema, searchQuerySchema, compareSchema } from "../schemas/parts.js";

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

function computeTrend(priceHistory, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const entries = (priceHistory || [])
    .filter((e) => new Date(e.date) >= cutoff && e.price > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (entries.length === 0) return null;
  const prices = entries.map((e) => e.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const change = prices[0] > 0 ? Math.round(((prices.at(-1) - prices[0]) / prices[0]) * 1000) / 10 : 0;
  return { days, min, max, avg, first: prices[0], last: prices.at(-1), change, count: prices.length };
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

// GET /api/parts/search?q=...&category=...&priceMin=...&priceMax=...&sort=...&limit=...
router.get("/search", validate(searchQuerySchema, "query"), setCacheHeaders(60), async (req, res) => {
  const { q, category, manufacturer, priceMin, priceMax, sort = "price_asc", limit = 50 } = req.query;
  const cacheKey = `parts:search:${JSON.stringify(req.query)}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const filter = {};
    if (category) filter.category = category;

    const searchTerms = [q, manufacturer].filter(Boolean);
    if (searchTerms.length === 1) {
      filter.name = { $regex: searchTerms[0].trim(), $options: "i" };
    } else if (searchTerms.length === 2) {
      filter.$and = searchTerms.map((t) => ({ name: { $regex: t.trim(), $options: "i" } }));
    }

    if (priceMin || priceMax) {
      filter.price = {};
      if (priceMin) filter.price.$gte = Number(priceMin);
      if (priceMax) filter.price.$lte = Number(priceMax);
    }

    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    let parts;
    if (sort === "value_desc") {
      const pipeline = [
        { $match: { ...filter, price: { ...(filter.price || {}), $gt: 0 }, benchmarkScore: { $exists: true } } },
        {
          $addFields: {
            _valueScore: {
              $cond: {
                if: { $gt: ["$price", 0] },
                then: {
                  $divide: [
                    {
                      $add: [
                        { $ifNull: ["$benchmarkScore.passmarkscore", 0] },
                        { $ifNull: ["$benchmarkScore.3dmarkscore", 0] },
                        { $ifNull: ["$benchmarkScore.memoryscore", 0] },
                        { $ifNull: ["$benchmarkScore.storagescore", 0] },
                      ],
                    },
                    "$price",
                  ],
                },
                else: 0,
              },
            },
          },
        },
        { $sort: { _valueScore: -1 } },
        { $limit: limitNum },
        { $project: { priceHistory: 0 } },
      ];
      parts = await db.collection("parts").aggregate(pipeline).toArray();
    } else {
      const sortMap = {
        price_asc: { price: 1 },
        price_desc: { price: -1 },
        score_desc: { "benchmarkScore.passmarkscore": -1, "benchmarkScore.3dmarkscore": -1 },
      };
      parts = await db
        .collection("parts")
        .find(filter)
        .project({ priceHistory: 0 })
        .sort(sortMap[sort] || { price: 1 })
        .limit(limitNum)
        .toArray();
    }

    setCache(cacheKey, parts, 60 * 1000);
    res.json(parts);
  } catch (err) {
    res.status(500).json({ error: "검색 실패" });
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

// POST /api/parts/compare
router.post("/compare", validate(compareSchema), async (req, res) => {
  const { parts } = req.body;
  try {
    const db = getDB();
    const docs = await Promise.all(
      parts.map(({ category, name }) =>
        db.collection("parts").findOne({ category, name }, { projection: { priceHistory: 0 } })
      )
    );

    const found = docs.filter(Boolean);
    if (found.length < 2)
      return res.status(404).json({ error: "비교할 부품을 2개 이상 찾을 수 없습니다." });

    const withScores = found.map((p) => {
      const scores = p.benchmarkScore || {};
      const totalScore = Object.values(scores).reduce((s, v) => s + (Number(v) || 0), 0);
      const valueScore = p.price > 0 && totalScore > 0
        ? Math.round((totalScore / p.price) * 1000) / 1000
        : 0;
      return { ...p, _totalScore: totalScore, _valueScore: valueScore };
    });

    const minPrice = Math.min(...withScores.filter((p) => p.price > 0).map((p) => p.price));
    const maxScore = Math.max(...withScores.map((p) => p._totalScore));
    const maxValue = Math.max(...withScores.map((p) => p._valueScore));

    const comparison = withScores.map((p) => ({
      ...p,
      _isBestPrice: p.price === minPrice && p.price > 0,
      _isBestScore: p._totalScore === maxScore && maxScore > 0,
      _isBestValue: p._valueScore === maxValue && maxValue > 0,
      _scoreVsMax: maxScore > 0 ? Math.round((p._totalScore / maxScore) * 100) : 0,
    }));

    res.json({ count: comparison.length, parts: comparison });
  } catch (err) {
    res.status(500).json({ error: "비교 실패" });
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

// GET /api/parts/:category/:name/trend
router.get("/:category/:name/trend", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });

    const trends = [30, 60, 90].map((days) => computeTrend(part.priceHistory, days)).filter(Boolean);

    res.json({
      name: part.name,
      category: part.category,
      currentPrice: part.price || 0,
      trends,
    });
  } catch (err) {
    res.status(500).json({ error: "가격 추세 조회 실패" });
  }
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
