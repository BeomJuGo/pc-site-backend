import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ GPT에게 CPU 모델명만 전달해 추천 받기
const askGPTWithModelNamesOnly = async (cpuNames) => {
  const prompt = `
다음은 판매 중인 CPU 모델명 리스트입니다:

${cpuNames.map((name, i) => `${i + 1}. ${name}`).join("\n")}

이 중에서 각각 3개씩 추천해주세요:

1. 가성비 좋은 CPU
2. 게이밍에 적합한 CPU
3. 전문가용 작업(편집, CAD, 3D 렌더링)에 적합한 CPU

아래 JSON 형식으로 답해주세요:
{
  "가성비": [{ "name": "...", "reason": "..." }, ...],
  "게이밍": [{ "name": "...", "reason": "..." }, ...],
  "전문가용": [{ "name": "...", "reason": "..." }, ...]
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
    const cpus = await db
      .collection("cpus")
      .find({}, { projection: { _id: 0, name: 1 } })
      .limit(40)
      .toArray();

    const cpuNames = cpus.map((c) => c.name);
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
