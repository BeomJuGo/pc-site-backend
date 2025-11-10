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
    const decodedName = decodeURIComponent(name);
    
    // 정확한 이름 매칭 시도
    let part = await db.collection("parts").findOne({
      category,
      name: decodedName,
    });
    
    // 정확한 매칭이 실패하면 부분 매칭 시도 (괄호 제거 후 비교)
    if (!part) {
      const cleanDecodedName = decodedName.split("(")[0].trim();
      const allParts = await db.collection("parts").find({ category }).toArray();
      part = allParts.find(p => {
        const cleanDbName = p.name.split("(")[0].trim();
        return cleanDbName === cleanDecodedName;
      });
    }
    
    // 부분 매칭도 실패하면 이름이 포함된 것 찾기
    if (!part) {
      const allParts = await db.collection("parts").find({ category }).toArray();
      part = allParts.find(p => {
        const cleanDbName = p.name.split("(")[0].trim();
        const cleanSearchName = decodedName.split("(")[0].trim();
        return cleanDbName.includes(cleanSearchName) || cleanSearchName.includes(cleanDbName);
      });
    }
    
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
    const decodedName = decodeURIComponent(name);
    
    // 정확한 이름 매칭 시도
    let part = await db.collection("parts").findOne({
      category,
      name: decodedName,
    });
    
    // 정확한 매칭이 실패하면 부분 매칭 시도 (괄호 제거 후 비교)
    if (!part) {
      const cleanDecodedName = decodedName.split("(")[0].trim();
      const allParts = await db.collection("parts").find({ category }).toArray();
      part = allParts.find(p => {
        const cleanDbName = p.name.split("(")[0].trim();
        return cleanDbName === cleanDecodedName;
      });
    }
    
    // 부분 매칭도 실패하면 이름이 포함된 것 찾기
    if (!part) {
      const allParts = await db.collection("parts").find({ category }).toArray();
      part = allParts.find(p => {
        const cleanDbName = p.name.split("(")[0].trim();
        const cleanSearchName = decodedName.split("(")[0].trim();
        return cleanDbName.includes(cleanSearchName) || cleanSearchName.includes(cleanDbName);
      });
    }
    
    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없음" });
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: "부품 상세 조회 실패" });
  }
});

export default router;
