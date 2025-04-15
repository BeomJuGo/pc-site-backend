// ✅ routes/parts.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// ✅ 부품 목록 조회 (카테고리별)
router.get("/:category", async (req, res) => {
  const category = req.params.category;

  try {
    const db = getDB();
    const parts = await db.collection("parts")
      .find({ category })
      .sort({ name: 1 })
      .toArray();

    res.json(parts);
  } catch (err) {
    console.error("❌ 부품 조회 실패:", err);
    res.status(500).json({ error: "부품 목록 조회 실패" });
  }
});

// ✅ 부품 상세 조회 (이름 기준)
router.get("/:category/:name", async (req, res) => {
  const { category, name } = req.params;

  try {
    const db = getDB();
    const part = await db.collection("parts").findOne({ category, name });
    if (!part) return res.status(404).json({ error: "Not found" });
    res.json(part);
  } catch (err) {
    console.error("❌ 상세 조회 오류:", err);
    res.status(500).json({ error: "상세 조회 실패" });
  }
});

export default router;
