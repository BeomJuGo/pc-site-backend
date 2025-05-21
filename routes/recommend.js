import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ GPT에게 직접 추천 요청
const askGPTForRecommendation = async (cpuList) => {
  const prompt = `
아래는 판매 중인 CPU 목록이야. 각 CPU는 이름, 가격(원), 성능 점수(passmark 또는 cinebench)가 포함되어 있어.

${JSON.stringify(cpuList, null, 2)}

이 중에서:

1. 💸 가성비 좋은 CPU 3개
2. 🎮 게임용으로 적합한 CPU 3개
3. 🎬 전문가용(영상편집, 3D 작업 등)에 적합한 CPU 3개

를 각각 골라줘. 이유는 한 줄씩 간단하게 설명해줘. JSON 형식으로 아래처럼 답해줘:

{
  "가성비": [{ "name": "...", "reason": "..." }, ...],
  "게이밍": [{ "name": "...", "reason": "..." }, ...],
  "전문가용": [{ "name": "...", "reason": "..." }, ...]
}
`;

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
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;

  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.error("❌ GPT 응답 파싱 실패:", raw);
    return null;
  }
};

// ✅ 추천 API
router.post("/", async (req, res) => {
  console.log("🔔 [추천 API 호출됨] POST /api/recommend");

  try {
    const db = await getDB();
    const cpus = await db.collection("cpus")
      .find({}, { projection: { _id: 0, name: 1, price: 1, benchmarkScore: 1 } })
      .toArray();

    const formatted = cpus.map((cpu) => ({
      name: cpu.name,
      price: cpu.price,
      passmark: cpu.benchmarkScore?.passmarkscore || null,
      cinebench: cpu.benchmarkScore?.cinebenchMulti || null,
    }));

    const gptResult = await askGPTForRecommendation(formatted);

    if (!gptResult) {
      return res.status(500).json({ error: "GPT 응답 파싱 실패" });
    }

    return res.json({ recommended: gptResult });
  } catch (err) {
    console.error("❌ 추천 실패:", err);
    return res.status(500).json({ error: "추천 처리 중 서버 오류" });
  }
});

export default router;
