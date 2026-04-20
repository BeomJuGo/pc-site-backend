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
  part = await db.collection("parts").findOne({
    category,
    name: { $regex: `^${escaped}`, $options: "i" },
  });
  if (part) return part;

  return db.collection("parts").findOne({
    category,
    name: { $regex: escaped, $options: "i" },
  });
}

// /api/parts?category=cpu|gpu|...&page=1&limit=50
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

// \uac00\uaca9 \ud788\uc2a4\ud1a0\ub9ac: /api/parts/:category/:name/history
router.get("/:category/:name/history", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "\ubd80\ud488\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc74c" });
    res.json({ priceHistory: part.priceHistory || [] });
  } catch (err) {
    res.status(500).json({ error: "\uac00\uaca9 \ud788\uc2a4\ud1a0\ub9ac \uc870\ud68c \uc2e4\ud328" });
  }
});

// \uc0c1\uc138 \uc815\ubcf4: /api/parts/:category/:name
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
