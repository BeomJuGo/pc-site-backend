// routes/parts.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

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
    const part = await db.collection("parts").findOne({
      category,
      name: decodeURIComponent(name),
    });
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
    const part = await db.collection("parts").findOne({
      category,
      name: decodeURIComponent(name),
    });
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: "부품 상세 조회 실패" });
  }
});

export default router;
