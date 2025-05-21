import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const askGPTWithModelNamesOnly = async (cpuNames) => {
  const formatted = cpuNames.map((name, i) => `${i + 1}. ${name}`).join("\n");

  const prompt = `
다음은 판매 중인 CPU 모델명 목록입니다. 반드시 이 목록 중에서만 추천해 주세요:

${formatted}

아래의 3가지 용도에 대해 각각 3개씩 추천해주세요:
1. 가성비
2. 게이밍
3. 전문가용 (영상 편집, 3D 렌더링, CAD 등)

아래 JSON 형식으로만 답변해주세요. 설명문은 절대 포함하지 마세요.
{
  "가성비": [
    { "name": "모델명", "reason": "추천 이유" },
    ...
  ],
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
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    return JSON.parse(raw.slice(start, end));
  } catch (err) {
    console.error("❌ JSON 파싱 실패:", raw);
    return null;
  }
};

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
