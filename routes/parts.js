// ✅ routes/parts.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// ✅ CPU 전체 목록 가져오기
router.get("/cpu", async (req, res) => {
  try {
    const db = getDB();
    const cpus = await db.collection("parts").find({ category: "cpu" }).toArray();
    res.json(cpus);
  } catch (err) {
    console.error("❌ CPU 목록 조회 실패:", err);
    res.status(500).json({ error: "CPU 목록 조회 실패" });
  }
});

// ✅ CPU 단일 항목 가져오기 (벤치마크, 가격추이 포함)
router.get("/cpu/:name", async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const db = getDB();
    const cpu = await db.collection("parts").findOne({ category: "cpu", name });
    if (!cpu) return res.status(404).json({ error: "CPU 없음" });
    res.json(cpu);
  } catch (err) {
    console.error("❌ CPU 상세 조회 실패:", err);
    res.status(500).json({ error: "CPU 상세 조회 실패" });
  }
});

export default router;
