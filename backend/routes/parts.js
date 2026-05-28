// routes/parts.js
import express from "express";
import { getDB } from "../db.js";
import { getCache, setCache } from "../utils/responseCache.js";
import { buildValueRankPipeline, buildBudgetPicksPipeline, BUDGET_RATIOS } from "../utils/aggregations.js";
import { setCacheHeaders } from "../middleware/httpCache.js";
import { validate } from "../middleware/validate.js";
import { valueRankQuerySchema, budgetPicksQuerySchema, batchQuerySchema, searchQuerySchema, compareSchema } from "../schemas/parts.js";
import logger from "../utils/logger.js";

const router = express.Router();

// 사용자 입력 Regex 특수문자 이스케이프 (ReDoS 방어)
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findPartByName(db, category, rawName) {
  const decoded = decodeURIComponent(rawName);
  let part = await db.collection("parts").findOne({ category, name: decoded });
  if (part) return part;
  const cleanName = decoded.split("(")[0].trim();
  const escaped = escapeRegex(cleanName);
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

// 제품명에서 출시 연도를 추론 (GPU/CPU 세대, 칩셋, 메모리 규격 기반)
function inferReleaseYear(name) {
  const n = name || "";
  // NVIDIA GPU
  if (/RTX\s*50[0-9]{2}/i.test(n)) return 2025;
  if (/RTX\s*40[0-9]{2}/i.test(n)) return 2023;
  if (/RTX\s*30[0-9]{2}/i.test(n)) return 2021;
  if (/RTX\s*20[0-9]{2}/i.test(n)) return 2019;
  if (/GTX\s*16[0-9]{2}/i.test(n)) return 2019;
  if (/GTX\s*10[0-9]{2}/i.test(n)) return 2017;
  // AMD GPU
  if (/RX\s*9[0-9]{3}/i.test(n)) return 2025;
  if (/RX\s*7[0-9]{3}/i.test(n)) return 2023;
  if (/RX\s*6[0-9]{3}/i.test(n)) return 2021;
  if (/RX\s*5[0-9]{3}/i.test(n)) return 2020;
  // AMD Ryzen (모델 번호 첫자리 = 세대)
  if (/(?:라이젠|Ryzen)\s*\d+\s+9[0-9]{3}/i.test(n)) return 2024;
  if (/(?:라이젠|Ryzen)\s*\d+\s+7[0-9]{3}/i.test(n)) return 2023;
  if (/(?:라이젠|Ryzen)\s*\d+\s+5[0-9]{3}/i.test(n)) return 2021;
  if (/(?:라이젠|Ryzen)\s*\d+\s+3[0-9]{3}/i.test(n)) return 2019;
  if (/(?:라이젠|Ryzen)\s*\d+\s+2[0-9]{3}/i.test(n)) return 2018;
  // Intel Core Ultra
  if (/Core\s*Ultra\s*[23][0-9]{2}/i.test(n)) return 2025;
  if (/Core\s*Ultra\s*[0-9]{3}/i.test(n)) return 2024;
  // Intel Core i-시리즈 (14세대~8세대)
  if (/i[3579]-1[45][0-9]{3}/i.test(n)) return 2024;
  if (/i[3579]-13[0-9]{3}/i.test(n)) return 2023;
  if (/i[3579]-12[0-9]{3}/i.test(n)) return 2022;
  if (/i[3579]-11[0-9]{3}/i.test(n)) return 2021;
  if (/i[3579]-10[0-9]{3}/i.test(n)) return 2020;
  if (/i[3579]-[89][0-9]{3}/i.test(n)) return 2018;
  // 메인보드 칩셋
  if (/\b(Z890|B860|B840|X870)\b/i.test(n)) return 2024;
  if (/\b(Z790|B760|B660|X670E?|B650E?)\b/i.test(n)) return 2022;
  if (/\b(Z690|B560|H570)\b/i.test(n)) return 2021;
  if (/\b(Z590|B550|X570)\b/i.test(n)) return 2020;
  if (/\b(Z490|B460|H410)\b/i.test(n)) return 2020;
  if (/\b(Z390|B365|B360|X470|B450)\b/i.test(n)) return 2018;
  if (/\b(Z370|X370|B350|A320)\b/i.test(n)) return 2017;
  // 메모리 규격
  if (/DDR5/i.test(n)) return 2022;
  if (/DDR4/i.test(n)) return 2017;
  if (/DDR3/i.test(n)) return 2012;
  // NVMe/SSD 세대
  if (/PCIe\s*5\.0|Gen\s*5/i.test(n)) return 2023;
  if (/PCIe\s*4\.0|Gen\s*4/i.test(n)) return 2020;
  return 2018;
}

// 카테고리 목록 필터를 MongoDB 쿼리로 변환
function buildCategoryQuery(params) {
  const {
    category, q, brand, socket, chipset, memCap, memDdr,
    storageType, storageIface, storageCap, psuWatt, caseForm,
    conditionShow, conditionHide, packType, design,
  } = params;

  const must = [];

  if (category) must.push({ category });
  if (category === "motherboard") must.push({ price: { $gte: 50000 } });
  if (q?.trim()) must.push({ name: { $regex: escapeRegex(q.trim()), $options: "i" } });

  if (brand && brand !== "all") {
    const AMD_MB = ["a320","a520","a620","b350","b450","b550","b650","b850","x370","x470","x570","x670","x870"].join("|");
    const INT_MB = ["h81","h97","h110","h170","h270","h310","h370","h410","h470","h510","h610","h810","b150","b250","b360","b365","b460","b560","b660","b760","b840","b860","z170","z270","z370","z390","z490","z590","z690","z790","z890"].join("|");
    const BRAND_RE = {
      cpu:  { intel: "인텔|\\bintel\\b|\\bcore\\b|\\bi[3579][ -]", amd: "\\bamd\\b|라이젠|\\bryzen\\b|\\bthreadripper\\b" },
      gpu:  { nvidia: "지포스|geforce|\\brtx\\b|\\bgtx\\b|\\bnvidia\\b", amd: "라데온|\\bradeon\\b|\\brx\\s*\\d" },
      motherboard: { amd: `\\b(${AMD_MB})\\b`, intel: `\\b(${INT_MB})\\b` },
    };
    const re = BRAND_RE[category]?.[brand.toLowerCase()];
    if (re) must.push({ name: { $regex: re, $options: "i" } });
  }

  if (socket && socket !== "all") {
    const sr = escapeRegex(socket);
    must.push({ $or: [{ name: { $regex: sr, $options: "i" } }, { info: { $regex: sr, $options: "i" } }, { specSummary: { $regex: sr, $options: "i" } }] });
  }

  if (chipset && chipset !== "all") {
    must.push({ name: { $regex: `\\b${escapeRegex(chipset)}\\b`, $options: "i" } });
  }

  if (memCap && memCap !== "all") {
    const n = memCap.replace("GB", "");
    const cr = `\\b${n}\\s*gb\\b`;
    must.push({ $or: [{ name: { $regex: cr, $options: "i" } }, { info: { $regex: cr, $options: "i" } }, { specSummary: { $regex: cr, $options: "i" } }] });
  }

  if (memDdr && memDdr !== "all") {
    must.push({ $or: [{ name: { $regex: memDdr, $options: "i" } }, { info: { $regex: memDdr, $options: "i" } }] });
  }

  if (storageType && storageType !== "all") {
    must.push({ $or: [{ "specs.type": { $regex: `^${escapeRegex(storageType)}$`, $options: "i" } }, { name: { $regex: `\\b${escapeRegex(storageType)}\\b`, $options: "i" } }] });
  }

  if (storageIface && storageIface !== "all") {
    must.push({ $or: [{ "specs.interface": { $regex: escapeRegex(storageIface), $options: "i" } }, { name: { $regex: `\\b${escapeRegex(storageIface)}\\b`, $options: "i" } }] });
  }

  const STORAGE_CAP_PATS = {
    "128GB": ["128gb"], "256GB": ["256gb","240gb"], "500GB": ["500gb","512gb"],
    "1TB": ["1tb"], "2TB": ["2tb"], "4TB": ["4tb"], "8TB": ["8tb"],
    "12TB+": ["12tb","14tb","16tb","18tb","20tb","22tb","24tb"],
  };
  if (storageCap && storageCap !== "all") {
    const pats = STORAGE_CAP_PATS[storageCap];
    if (pats) must.push({ $or: pats.map((p) => ({ name: { $regex: `\\b${p}\\b`, $options: "i" } })) });
  }

  if (psuWatt && psuWatt !== "all") {
    const w = escapeRegex(String(psuWatt));
    must.push({ $or: [{ info: { $regex: `wattage:\\s*${w}\\s*w`, $options: "i" } }, { name: { $regex: `${w}\\s*w(?:\\b|$)`, $options: "i" } }] });
  }

  if (caseForm && caseForm !== "all") {
    const CASE_RE = {
      "ATX":      { match: "\\batx\\b", exclude: "m-?atx|matx|micro|e-?atx|eatx" },
      "mATX":     { match: "m-?atx|matx|micro.?atx" },
      "Mini-ITX": { match: "mini.?itx" },
      "E-ATX":    { match: "e-?atx|eatx" },
    };
    const cf = CASE_RE[caseForm];
    if (cf) {
      must.push({ $or: [{ name: { $regex: cf.match, $options: "i" } }, { "specs.formFactor": { $regex: cf.match, $options: "i" } }] });
      if (cf.exclude) must.push({ name: { $not: { $regex: cf.exclude, $options: "i" } } });
    }
  }

  const COND_RE = { used: "중고", refer: "리퍼비시", parallel: "병행수입" };
  if (conditionShow) {
    const orConds = conditionShow.split(",").filter(Boolean).map((c) => COND_RE[c]).filter(Boolean).map((r) => ({ name: { $regex: r } }));
    if (orConds.length) must.push({ $or: orConds });
  }
  if (conditionHide) {
    for (const c of conditionHide.split(",").filter(Boolean)) {
      if (COND_RE[c]) must.push({ name: { $not: { $regex: COND_RE[c] } } });
    }
  }

  if (packType === "multipack") must.push({ name: { $regex: "멀티팩" } });
  else if (packType === "standard") must.push({ name: { $not: { $regex: "멀티팩" } } });

  if (design && design !== "all" && ["case", "cooler", "memory"].includes(category)) {
    const DESIGN_RE = {
      rgb:   "\\bARGB\\b|\\bRGB\\b|DRGB|aRGB|AURA|Mystic\\s*Light",
      white: "화이트|\\bwhite\\b|아이보리|\\bW\\s*Edition",
    };
    const re = DESIGN_RE[design];
    if (re) must.push({ name: { $regex: re, $options: "i" } });
  }

  if (must.length === 0) return {};
  if (must.length === 1) return must[0];
  return { $and: must };
}

function buildSortConfig(sort, category) {
  const VALUE_SCORE = { cpu: "$benchmarkScore.passmarkscore", gpu: "$benchmarkScore.3dmarkscore" };
  switch (sort) {
    case "price":      return { sortDoc: { price: 1 }, isValue: false };
    case "price-desc": return { sortDoc: { price: -1 }, isValue: false };
    case "score":      return { sortDoc: { "benchmarkScore.passmarkscore": -1 }, isValue: false };
    case "3dmark":     return { sortDoc: { "benchmarkScore.3dmarkscore": -1 }, isValue: false };
    case "latest":     return { sortDoc: { _id: -1 }, isValue: false };
    case "release":    return { isRelease: true };
    case "value": {
      const scoreField = VALUE_SCORE[category];
      if (scoreField) return { isValue: true, scoreField };
      return { sortDoc: { mallCount: -1 }, isValue: false };
    }
    default:
      return { sortDoc: { mallCount: -1 }, isValue: false };
  }
}

// GET /api/parts?category=cpu&page=1&limit=24&sort=value&brand=intel&socket=AM5 ...
router.get("/", setCacheHeaders(60, 1800), async (req, res) => {
  const {
    category, page, limit, sort = "popularity",
    q, brand, socket, chipset, memCap, memDdr,
    storageType, storageIface, storageCap, psuWatt, caseForm,
    conditionShow, conditionHide, packType, design,
  } = req.query;

  try {
    const db = getDB();
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 24));
    const skip = (pageNum - 1) * limitNum;

    const query = buildCategoryQuery({
      category, q, brand, socket, chipset, memCap, memDdr,
      storageType, storageIface, storageCap, psuWatt, caseForm,
      conditionShow, conditionHide, packType, design,
    });
    const sortConfig = buildSortConfig(sort, category);

    let parts, total;

    if (sortConfig.isValue) {
      const sf = sortConfig.scoreField;
      const pipeline = [
        { $match: { ...query, price: { $gt: 0 }, benchmarkScore: { $exists: true } } },
        { $addFields: { _vs: { $cond: [{ $gt: [{ $ifNull: [sf, 0] }, 0] }, { $divide: [sf, "$price"] }, 0] } } },
        { $facet: {
          data: [{ $sort: { _vs: -1 } }, { $skip: skip }, { $limit: limitNum }, { $project: { priceHistory: 0, _vs: 0 } }],
          count: [{ $count: "total" }],
        }},
      ];
      const [result] = await db.collection("parts").aggregate(pipeline).toArray();
      parts = result?.data || [];
      total = result?.count?.[0]?.total || 0;
    } else if (sortConfig.isRelease) {
      const all = await db.collection("parts").find(query).project({ priceHistory: 0 }).toArray();
      all.sort((a, b) => inferReleaseYear(b.name) - inferReleaseYear(a.name));
      total = all.length;
      parts = all.slice(skip, skip + limitNum);
    } else {
      [parts, total] = await Promise.all([
        db.collection("parts").find(query).project({ priceHistory: 0 }).sort(sortConfig.sortDoc).skip(skip).limit(limitNum).toArray(),
        db.collection("parts").countDocuments(query),
      ]);
    }

    res.set("X-Total-Count", String(total));
    res.set("X-Page", String(pageNum));
    res.set("X-Total-Pages", String(Math.ceil(total / limitNum)));
    res.json(parts);
  } catch (err) {
    logger.error({ err }, "부품 목록 조회 실패");
    res.status(500).json({ error: "부품 목록 조회 실패" });
  }
});

// GET /api/parts/search?q=...&category=...&priceMin=...&priceMax=...&sort=...&limit=...
router.get("/search", validate(searchQuerySchema, "query"), setCacheHeaders(300, 3600), async (req, res) => {
  const { q, category, manufacturer, priceMin, priceMax, sort = "price_asc", limit = 50 } = req.query;
  const cacheKey = `parts:search:${JSON.stringify(req.query)}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const filter = {};
    if (category) filter.category = category;

    const searchTerms = [q, manufacturer].filter(Boolean);
    if (searchTerms.length === 1) {
      // escapeRegex로 ReDoS 방어
      filter.name = { $regex: escapeRegex(searchTerms[0].trim()), $options: "i" };
    } else if (searchTerms.length === 2) {
      filter.$and = searchTerms.map((t) => ({ name: { $regex: escapeRegex(t.trim()), $options: "i" } }));
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

    setCache(cacheKey, parts, 5 * 60 * 1000);
    res.json(parts);
  } catch (err) {
    logger.error({ err }, "검색 실패");
    res.status(500).json({ error: "검색 실패" });
  }
});

// GET /api/parts/value-rank?category=gpu&limit=20
router.get("/value-rank", validate(valueRankQuerySchema, "query"), setCacheHeaders(600, 3600), async (req, res) => {
  const { category, limit = 20 } = req.query;
  const cacheKey = `parts:value-rank:${category}:${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const pipeline = buildValueRankPipeline(category, Number(limit));
    const ranked = await db.collection("parts").aggregate(pipeline).toArray();
    setCache(cacheKey, ranked, 5 * 60 * 1000);
    res.json(ranked);
  } catch (err) {
    logger.error({ err }, "가성비 순위 조회 실패");
    res.status(500).json({ error: "가성비 순위 조회 실패" });
  }
});

// GET /api/parts/budget-picks?budget=1000000
router.get("/budget-picks", validate(budgetPicksQuerySchema, "query"), setCacheHeaders(600, 3600), async (req, res) => {
  const { budget } = req.query;
  const budgetNum = Number(budget);
  const cacheKey = `parts:budget-picks:${budgetNum}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const pipeline = buildBudgetPicksPipeline(budgetNum);
    const [facetResult] = await db.collection("parts").aggregate(pipeline).toArray();
    if (!facetResult) return res.status(404).json({ error: "예산에 맞는 부품을 찾을 수 없습니다." });

    const budgetAllocation = Object.fromEntries(
      Object.entries(BUDGET_RATIOS).map(([cat, ratio]) => [cat, Math.round(budgetNum * ratio)])
    );

    const result = { budget: budgetNum, budgetAllocation, picks: facetResult };
    setCache(cacheKey, result, 5 * 60 * 1000);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "예산별 추천 조회 실패");
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
    logger.error({ err }, "일괄 조회 실패");
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
    logger.error({ err }, "비교 실패");
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

// GET /api/parts/price-drops?limit=10
router.get("/price-drops", setCacheHeaders(600, 3600), async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
  const cacheKey = `parts:price-drops:${limit}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const db = getDB();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const pipeline = [
      { $match: { price: { $gt: 0 } } },
      { $project: {
        name: 1, category: 1, price: 1, image: 1,
        refEntries: {
          $filter: {
            input: { $ifNull: ["$priceHistory", []] },
            as: "e",
            cond: { $and: [
              { $gte: ["$$e.date", thirtyDaysAgo] },
              { $lte: ["$$e.date", sevenDaysAgo] },
              { $gt: ["$$e.price", 0] },
            ]},
          },
        },
      }},
      { $match: { "refEntries.0": { $exists: true } } },
      { $addFields: { prevPrice: { $round: [{ $avg: "$refEntries.price" }, 0] } } },
      { $addFields: {
        dropAmt: { $round: [{ $subtract: ["$prevPrice", "$price"] }, 0] },
        dropPct: { $round: [{ $multiply: [
          { $divide: [{ $subtract: ["$prevPrice", "$price"] }, "$prevPrice"] }, 100,
        ]}, 1] },
      }},
      { $match: { dropAmt: { $gt: 0 } } },
      { $sort: { dropPct: -1 } },
      { $limit: limit },
      { $project: { name: 1, category: 1, price: 1, image: 1, prevPrice: 1, dropAmt: 1, dropPct: 1 } },
    ];

    const drops = await db.collection("parts").aggregate(pipeline).toArray();
    setCache(cacheKey, drops, 5 * 60 * 1000);
    res.json(drops);
  } catch (err) {
    logger.error({ err }, "가격 하락 조회 실패");
    res.status(500).json({ error: "가격 하락 조회 실패" });
  }
});

// GET /api/parts/:category/:name/trend
router.get("/:category/:name/trend", setCacheHeaders(600, 3600), async (req, res) => {
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
    logger.error({ err }, "가격 추세 조회 실패");
    res.status(500).json({ error: "가격 추세 조회 실패" });
  }
});

// GET /api/parts/:category/:name/history
router.get("/:category/:name/history", setCacheHeaders(600, 3600), async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json({ name: part.name, category: part.category, priceHistory: part.priceHistory || [] });
  } catch (err) {
    logger.error({ err }, "가격 히스토리 조회 실패");
    res.status(500).json({ error: "가격 히스토리 조회 실패" });
  }
});

// GET /api/parts/:category/:name
router.get("/:category/:name", setCacheHeaders(300, 3600), async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json(part);
  } catch (err) {
    logger.error({ err }, "부품 상세 조회 실패");
    res.status(500).json({ error: "부품 상세 조회 실패" });
  }
});

export default router;
