import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// GPT를 이용해 목적에 따라 추천 CPU 이름 리스트 받아오기
const getGPTRecommendedCPUs = async (purpose) => {
  const promptMap = {
    가성비: "2025년 기준으로 가성비 좋은 CPU 5개를 추천해줘. AMD와 Intel 포함. 모델명만 알려줘.",
    게이밍: "2025년 게이머들에게 인기 있는 CPU 5개를 추천해줘. AMD와 Intel 포함. 모델명만 알려줘.",
    전문가용: "영상 편집, 3D 모델링, CAD 등 전문가용 작업에 적합한 CPU 5개를 추천해줘. AMD와 Intel 포함. 모델명만 알려줘.",
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "system", content: "너는 PC 부품 추천 전문가야." },
        { role: "user", content: promptMap[purpose] },
      ],
    }),
  });

  const data = await res.json();
  const gptText = data.choices[0].message.content;

  return gptText
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter((name) => name.length > 0);
};

// ✅ /api/recommend POST 라우트
router.get("/test", (req, res) => {
  res.send("✅ 추천 API 정상 연결됨");
});

router.post("/", async (req, res) => {
  console.log("🔔 [추천 API 호출됨] POST /api/recommend");
  const { budget, purpose } = req.body;

  if (!budget || !purpose) {
    return res.status(400).json({ error: "budget과 purpose를 입력해주세요." });
  }

  const db = await getDB();
  const cpuCol = db.collection("cpus");

  try {
    // GPT로 목적에 맞는 CPU 모델명 받기
    const gptNames = await getGPTRecommendedCPUs(purpose);
    console.log("💬 [GPT 추천 CPU 목록]", gptNames);

    // MongoDB에서 해당 이름이 포함된 CPU만 필터링
    const matchedCPUs = await cpuCol
      .find({
        $or: gptNames.map((name) => ({
          name: { $regex: new RegExp(name, "i") },
        })),
      })
      .toArray();

    if (matchedCPUs.length === 0) {
      console.warn("⚠️ DB에서 일치하는 CPU 없음");
      return res.status(404).json({ message: "DB에서 일치하는 CPU를 찾을 수 없습니다." });
    }

    // 예산 범위 ±5% 계산
    const min = budget * 0.95;
    const max = budget * 1.05;

    // 가격 기준 필터링 후 상위 3개 추천
    const recommended = matchedCPUs
      .filter((cpu) => cpu.price >= min && cpu.price <= max)
      .slice(0, 3);

    console.log("✅ 추천 완료:", recommended.map((c) => c.name));

    return res.json({
      purpose,
      budget,
      gptCandidates: gptNames,
      recommendedCPUs: recommended,
    });
  } catch (err) {
    console.error("❌ 추천 실패:", err);
    res.status(500).json({ error: "GPT 추천 또는 DB 처리 중 오류 발생" });
  }
});

export default router;
