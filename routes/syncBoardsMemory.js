// routes/syncBoardsMemory.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// GPT를 통해 인기 메모리/메인보드 목록 가져오기 (가격 없이)
async function fetchPartsFromGPT() {
  const prompt = `당신은 PC 부품 전문가입니다.
대한민국에서 2025년 현재 유통 중인 인기 메모리(RAM) 및 메인보드(Motherboard) 제품들을
카테고리당 20개 이상 JSON 배열로 반환해주세요.
각 항목은 {
  "category": "memory" 또는 "motherboard",
  "name": "정확한 제품 전체명",
  "info": "주요 사양 요약"
}
형식으로 작성해 주세요.
가격 정보는 포함하지 마세요.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "[]";
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ GPT 호출 오류", err);
    return [];
  }
}

// MongoDB 저장: 가격·이미지 없이 info만 저장
async function saveToDB(parts) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col
    .find({ category: { $in: ["motherboard", "memory"] } })
    .toArray();
  const currentNames = new Set(parts.map((p) => p.name));

  for (const p of parts) {
    const old = existing.find(
      (e) => e.name === p.name && e.category === p.category
    );
    const update = {
      category: p.category,
      specSummary: p.info,
      review: "",
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log("🔁 업데이트됨:", p.name);
    } else {
      await col.insertOne({
        name: p.name,
        ...update,
        priceHistory: [],
      });
      console.log("🆕 삽입됨:", p.name);
    }
  }

  // 목록에 없는 기존 항목 삭제
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);
  if (toDelete.length) {
    await col.deleteMany({
      category: { $in: ["motherboard", "memory"] },
      name: { $in: toDelete },
    });
    console.log("🗑️ 삭제됨:", toDelete.length);
  }
}

// 실행 라우터: POST /api/sync-boards-memory
router.post("/", (req, res) => {
  res.json({ message: "✅ 메인보드·메모리 동기화 시작됨 (가격 미포함)" });
  setImmediate(async () => {
    const rawList = await fetchPartsFromGPT();
    // 가격 조회를 제거하고 info만 저장
    await saveToDB(rawList);
    console.log("🎉 메인보드·메모리 정보 저장 완료");
  });
});

export default router;
