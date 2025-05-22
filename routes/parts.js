// ✅ routes/parts.js
import express from "express";
import { getDB } from "../db.js";
import { ObjectId } from "mongodb";

const router = express.Router();

// 🔧 이름 정제 함수
const clean = (str) => str.split("\n")[0].split("(")[0].trim();

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

// ✅ CPU 상세 정보 (이름 기반, 정규식 매칭)
router.get("/cpu/:name", async (req, res) => {
  try {
    const rawName = decodeURIComponent(req.params.name);
    const db = getDB();

    const regex = new RegExp(`^${clean(rawName)}`, "i");
    const cpu = await db.collection("parts").findOne({
      category: "cpu",
      name: { $regex: regex },
    });

    if (!cpu) return res.status(404).json({ error: "CPU 없음" });
    res.json(cpu);
  } catch (err) {
    console.error("❌ CPU 상세 조회 실패:", err);
    res.status(500).json({ error: "CPU 상세 조회 실패" });
  }
});

// ✅ CPU 상세 조회 (ID 기반)
router.get("/cpu/id/:id", async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const cpu = await db.collection("parts").findOne({ _id: new ObjectId(id) });
    if (!cpu) return res.status(404).json({ error: "CPU 없음" });
    res.json(cpu);
  } catch (err) {
    console.error("❌ CPU ID 조회 실패:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});



export default router;
