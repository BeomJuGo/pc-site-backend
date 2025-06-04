import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// 🔧 이름 정제 함수
const clean = (str) => str.split("\n")[0].split("(")[0].trim();

/**
 * ✅ 통합 부품 목록 API
 * GET /api/parts?category=cpu | gpu | memory | mainboard
 */
router.get("/", async (req, res) => {
  const category = req.query.category;
  if (!category) return res.status(400).json({ error: "카테고리 쿼리가 필요합니다." });

  try {
    const db = getDB();
    const parts = await db.collection("parts").find({ category }).toArray();
    res.json(parts);
  } catch (err) {
    console.error("❌ 부품 목록 조회 실패:", err);
    res.status(500).json({ error: "목록 조회 실패" });
  }
});

/**
 * ✅ 단일 부품 검색 (정규식 기반)
 * GET /api/parts/:category/:name
 */
router.get("/:category/:name", async (req, res) => {
  const { category, name } = req.params;

  try {
    const db = getDB();
    const regex = new RegExp(`^${clean(decodeURIComponent(name))}`, "i");

    const item = await db.collection("parts").findOne({
      category,
      name: { $regex: regex },
    });

    if (!item) return res.status(404).json({ error: "부품을 찾을 수 없습니다." });
    res.json(item);
  } catch (err) {
    console.error("❌ 부품 상세 조회 실패:", err);
    res.status(500).json({ error: "상세 조회 실패" });
  }
});

export default router;
