// routes/parts.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// /api/parts?category=cpu|gpu : 카테고리별 목록
router.get("/parts", async (req, res) => {
  const { category } = req.query;
  try {
    const db = getDB();
    const query = category ? { category } : {};
    const parts = await db.collection("parts").find(query).toArray();
    res.json(parts);
  } catch (err) {
    console.error("❌ [GET /parts] error:", err);
    res.status(500).json({ error: "부품 목록 조회 실패" });
  }
});

// /api/parts/:category/:name : 단일 부품 상세 정보
router.get("/parts/:category/:name", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await db.collection("parts").findOne({
      category,
      name: decodeURIComponent(name),
    });
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json(part);
  } catch (err) {
    console.error("❌ [GET /parts/:category/:name] error:", err);
    res.status(500).json({ error: "부품 상세 조회 실패" });
  }
});

// /api/parts/:category/:name/history : 가격 히스토리만 반환
router.get("/parts/:category/:name/history", async (req, res) => {
  const { category, name } = req.params;
  try {
    const db = getDB();
    const part = await db.collection("parts").findOne({
      category,
      name: decodeURIComponent(name),
    });
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json({ priceHistory: part.priceHistory || [] });
  } catch (err) {
    console.error("❌ [GET /parts/:category/:name/history] error:", err);
    res.status(500).json({ error: "가격 히스토리 조회 실패" });
  }
});

export default router;
