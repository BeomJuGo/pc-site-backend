import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ GPT에게 CPU 모델명만 전달해 추천 받기
const askGPTWithModelNamesOnly = async (cpuNames) => {
  const formatted = cpuNames.map((name, i) => `${i + 1}. ${name}`).join("\n");

  const prompt = `
아래는 판매 중인 CPU 모델명 리스트입니다. 이 리스트 중에서만 추천해 주세요:

${formatted}

각 카테고리에 대해 3개씩 추천해주세요:
- 가성비
- 게이밍
- 전문가용 (편집/3D 작업)

형식은 아래처럼 JSON으로 작성해주세요:
{
  "가성비": [{ "name": "모델명", "reason": "이유" }],
  "게이밍": [...],
  "전문가용": [...]
}`;

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
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ JSON 파싱 실패:", raw);
    return null;
  }
};

// ✅ 추천 API
router.post("/", async (req, res) => {
  console.log("🔔 [추천 API 호출됨] POST /api/recommend");

  try {
    const db = await getDB();
    const all = await db.collection("cpus").find({}).toArray();

    const byPassmark = [...all]
      .filter(c => c.benchmarkScore?.passmarkscore)
      .sort((a, b) => b.benchmarkScore.passmarkscore - a.benchmarkScore.passmarkscore)
      .slice(0, 15);

    const byValue = [...all]
      .filter(c => c.benchmarkScore?.passmarkscore && c.price)
      .map(c => ({
        ...c,
        valueScore: c.benchmarkScore.passmarkscore / c.price
      }))
      .sort((a, b) => b.valueScore - a.valueScore)
      .slice(0, 15);

    const cpuNames = [...new Set([...byPassmark, ...byValue].map(c => c.name))];
    const gptResult = await askGPTWithModelNamesOnly(cpuNames);

    if (!gptResult) {
      return res.status(500).json({ error: "GPT 응답 파싱 실패" });
    }

    return res.json({ recommended: gptResult });
  } catch (err) {
    console.error("❌ 추천 실패:", err);
    return res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
