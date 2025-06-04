import express from "express";
import { getDB } from "../db.js";
import { ObjectId } from "mongodb";

const router = express.Router();

// 이름 정제 함수 (기존 유지)
const clean = (str) => str.split("\n")[0].split("(")[0].trim();

// 기존 이름 기반 상세 조회 (유지)
router.get("/:category/:name", async (req, res) => {
  const { category, name } = req.params;
  const db = getDB();
  const nameDecoded = clean(decodeURIComponent(name));

  try {
    const exactItem = await db.collection("parts").findOne({ category, name: nameDecoded });
    if (exactItem) return res.json(exactItem);

    const regex = new RegExp(`^${nameDecoded}`, "i");
    const regexItem = await db.collection("parts").findOne({ category, name: { $regex: regex } });
    if (!regexItem) return res.status(404).json({ error: "부품을 찾을 수 없습니다." });

    res.json(regexItem);
  } catch (err) {
    console.error("❌ 부품 상세 조회 실패:", err);
    res.status(500).json({ error: "상세 조회 실패" });
  }
});

// 새 ID 기반 상세 조회 API (추가)
router.get("/:category/id/:id", async (req, res) => {
  const { category, id } = req.params;
  const db = getDB();

  try {
    const objectId = new ObjectId(id);
    const part = await db.collection("parts").findOne({ _id: objectId, category });

    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없습니다." });
    res.json(part);
  } catch (err) {
    console.error("❌ ID 기반 부품 상세 조회 실패:", err);
    res.status(500).json({ error: "상세 조회 실패" });
  }
});

export default router;
