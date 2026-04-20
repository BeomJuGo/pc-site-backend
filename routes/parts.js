// routes/parts.js
import express from "express";
import { getDB } from "../db.js";

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
router.get("/", async (req, res) => {
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
    res.status(500).json({ error: "\ubd80\ud488 \ubaa9\ub85d \uc870\ud68c \uc2e4\ud328" });
  }
});

// Feature 6: GET /api/parts/value-rank?category=gpu&limit=20
// \uc131\ub2a5/\uac00\uaca9\ube44 \uc21c\uc704 (benchmarkScore \u00f7 price)
router.get("/value-rank", async (req, res) => {
  const { category, limit } = req.query;
  if (!category) return res.status(400).json({ error: "category \ud30c\ub77c\ubbf8\ud130\uac00 \ud544\uc694\ud569\ub2c8\ub2e4." });
  try {
    const db = getDB();
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const scoreKey = { cpu: "passmarkscore", gpu: "3dmarkscore", memory: "memoryscore", storage: "storagescore" }[category];

    const parts = await db.collection("parts")
      .find({ category, price: { $gt: 0 }, benchmarkScore: { $exists: true } })
      .project({ priceHistory: 0 })
      .toArray();

    const ranked = parts
      .map(p => {
        const score = scoreKey ? (p.benchmarkScore?.[scoreKey] || 0) : Object.values(p.benchmarkScore || {})[0] || 0;
        return { ...p, _valueScore: score > 0 ? Math.round((score / p.price) * 1000) / 1000 : 0 };
      })
      .filter(p => p._valueScore > 0)
      .sort((a, b) => b._valueScore - a._valueScore)
      .slice(0, limitNum);

    res.json(ranked);
  } catch (err) {
    res.status(500).json({ error: "\uac00\uc131\ube44 \uc21c\uc704 \uc870\ud68c \uc2e4\ud328" });
  }
});

// Feature 7: POST /api/parts/batch - \ucd5c\uadfc \ubcf8 \ubd80\ud488 \uc77c\uad04 \uc870\ud68c
router.post("/batch", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "items \ubc30\uc5f4\uc774 \ud544\uc694\ud569\ub2c8\ub2e4. [{category, name}, ...]" });
    if (items.length > 50)
      return res.status(400).json({ error: "\ud55c \ubc88\uc5d0 \ucd5c\ub300 50\uac1c\uae4c\uc9c0 \uc870\ud68c \uac00\ub2a5\ud569\ub2c8\ub2e4." });

    const db = getDB();
    const results = await Promise.all(
      items.map(({ category, name }) =>
        category && name
          ? db.collection("parts").findOne({ category, name }, { projection: { priceHistory: 0 } })
          : null
      )
    );
    res.json(results.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: "\uc77c\uad04 \uc870\ud68c \uc2e4\ud328" });
  }
});

// Feature 5: GET /api/parts/budget-picks?budget=1000000
// \uc608\uc0b0\ubcc4 \uac01 \uce74\ud14c\uace0\ub9ac \ucd5c\uc801 \ubd80\ud488 TOP 3
router.get("/budget-picks", async (req, res) => {
  const { budget } = req.query;
  if (!budget) return res.status(400).json({ error: "budget \ud30c\ub77c\ubbf8\ud130\uac00 \ud544\uc694\ud569\ub2c8\ub2e4." });
  const budgetNum = parseInt(budget);
  if (isNaN(budgetNum) || budgetNum < 100000)
    return res.status(400).json({ error: "budget\uc740 \ucd5c\uc18c 100,000\uc6d0 \uc774\uc0c1\uc774\uc5b4\uc57c \ud569\ub2c8\ub2e4." });

  // \uc77c\ubc18\uc801\uc778 \uac8c\uc774\ubbf8\ub85d \uc6a9\ub3c4 \uae30\uc900 \uc608\uc0b0 \ubc30\ubd84 \ube44\uc728
  const ratios = { cpu: 0.25, gpu: 0.40, motherboard: 0.10, memory: 0.08, psu: 0.07, cooler: 0.04, storage: 0.06 };
  const scoreKeys = { cpu: "passmarkscore", gpu: "3dmarkscore", memory: "memoryscore", storage: "storagescore" };

  try {
    const db = getDB();
    const picks = {};
    const budgetAllocation = {};

    await Promise.all(
      Object.entries(ratios).map(async ([category, ratio]) => {
        const maxPrice = Math.round(budgetNum * ratio * 1.3);
        budgetAllocation[category] = Math.round(budgetNum * ratio);

        const parts = await db.collection("parts")
          .find({ category, price: { $gt: 0, $lte: maxPrice } })
          .project({ priceHistory: 0 })
          .toArray();

        const key = scoreKeys[category];
        picks[category] = parts
          .map(p => {
            const score = key ? (p.benchmarkScore?.[key] || 0) : 0;
            return { ...p, _valueScore: score > 0 ? score / p.price : 1 / p.price };
          })
          .sort((a, b) => b._valueScore - a._valueScore)
          .slice(0, 3)
          .map(({ _valueScore, ...rest }) => rest);
      })
    );

    res.json({ budget: budgetNum, budgetAllocation, picks });
  } catch (err) {
    res.status(500).json({ error: "\uc608\uc0b0\ubcc4 \ucd94\ucc9c \uc870\ud68c \uc2e4\ud328" });
  }
});

// Feature 8: GET /api/parts/danawa-url?name=PART_NAME
// \ub2e4\ub098\uc640 \uc9c1\uc811 \ub9c1\ud06c \uc0dd\uc131
router.get("/danawa-url", (req, res) => {
  const { name } = req.query;
  if (!name || typeof name !== "string" || name.trim() === "")
    return res.status(400).json({ error: "name \ud30c\ub77c\ubbf8\ud130\uac00 \ud544\uc694\ud569\ub2c8\ub2e4." });
  if (name.length > 200)
    return res.status(400).json({ error: "name\uc774 \ub108\ubb34 \uae38\ub2c8\ub2e4." });
  const url = `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(name.trim())}`;
  res.json({ url, name: name.trim() });
});

// \uac00\uaca9 \ud788\uc2a4\ud1a0\ub9ac: GET /api/parts/:category/:name/history
router.get("/:category/:name/history", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "\ubd80\ud488\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc74c" });
    res.json({ name: part.name, category: part.category, priceHistory: part.priceHistory || [] });
  } catch (err) {
    res.status(500).json({ error: "\uac00\uaca9 \ud788\uc2a4\ud1a0\ub9ac \uc870\ud68c \uc2e4\ud328" });
  }
});

// \uc0c1\uc138 \uc815\ubcf4: GET /api/parts/:category/:name
router.get("/:category/:name", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "\ubd80\ud488\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc74c" });
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: "\ubd80\ud488 \uc0c1\uc138 \uc870\ud68c \uc2e4\ud328" });
  }
});

export default router;
