import express from "express";
import { getDB } from "../db.js";
import { ObjectId } from "mongodb";

const router = express.Router();

// 🔧 이름 정제 함수: 줄바꿈 제거 + 괄호 앞까지 잘라내기
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

// ✅ CPU 단일 항목 가져오기 (정규식 기반 비교)
router.get("/cpu/:name", async (req, res) => {
  try {
    const rawName = decodeURIComponent(req.params.name);
    const db = getDB();
    const regex = new RegExp(`^${clean(rawName)}`, "i"); // 정규식 기반 검색

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

// ✅ _id 기반 단일 부품 상세 조회 (카드 클릭 시 연결)
router.get("/detail/:id", async (req, res) => {
  try {
    const db = getDB();
    const part = await db.collection("parts").findOne({ _id: new ObjectId(req.params.id) });

    if (!part) return res.status(404).json({ error: "부품을 찾을 수 없습니다." });
    res.json(part);
  } catch (err) {
    console.error("❌ _id 기반 부품 조회 실패:", err);
    res.status(500).json({ error: "부품 조회 실패" });
  }
});

export default router;
