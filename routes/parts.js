// routes/parts.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// 이름 fuzzy 매칭 헬퍼: 정확 매칭 → regex fallback (DB 레벨 처리)
async function findPartByName(db, category, rawName) {
  const decoded = decodeURIComponent(rawName);

  // 1차: 정확한 이름 매칭 (인덱스 활용)
  let part = await db.collection("parts").findOne({ category, name: decoded });
  if (part) return part;

  // 2차: 괄호 제거 후 접두사 매칭
  const cleanName = decoded.split("(")[0].trim();
  const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  part = await db.collection("parts").findOne({
    category,
    name: { $regex: `^${escaped}`, $options: "i" },
  });
  if (part) return part;

  // 3차: 부분 포함 매칭
  return db.collection("parts").findOne({
    category,
    name: { $regex: escaped, $options: "i" },
  });
}

// /api/parts?category=cpu|gpu|motherboard|memory
router.get("/", async (req, res) => {
  const { category } = req.query;
  try {
    const db = getDB();
    const query = category ? { category } : {};
    const parts = await db.collection("parts").find(query).toArray();
    res.json(parts);
  } catch (err) {
    res.status(500).json({ error: "부품 목록 조회 실패" });
  }
});

// 가격 히스토리: /api/parts/:category/:name/history
router.get("/:category/:name/history", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await findPartByName(db, category, name);
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json({ priceHistory: part.priceHistory || [] });
  } catch (err) {
    res.status(500).json({ error: "가격 히스토리 조회 실패" });
  }
});

// 상세 정보: /api/parts/:category/:name
router.get("/:category/:name", async (req, res) => {
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
