import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ GPT에게 CPU 모델명만 넘겨서 용도별 추천 받기
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

  try {
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
    console.log("🧠 GPT 응답 원문:\n", raw);

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    const jsonText = raw.slice(start, end);
    return JSON.parse(jsonText);
  } catch (err) {
    console.error("❌ GPT 요청 또는 응답 파싱 실패:", err);
    return null;
  }
};

// ✅ 추천 라우트
router.post("/", async (req, res) => {
  console.log("🔔 [추천 API 호출됨] POST /api/recommend");

  const { budget } = req.body;
  if (!budget) {
    return res.status(400).json({ error: "예산이 필요합니다." });
  }

  try {
    const db = await getDB();
    const cpuCol = db.collection("parts");
    const all = await cpuCol.find({ category: "cpu" }).toArray();
    console.log(`📺 DB에서 불러온 CPU 수: ${all.length}`);

    const min = budget * 0.95;
    const max = budget * 1.05;
    const filtered = all.filter(c => c.price >= min && c.price <= max);
    console.log(`🔎 예산 필터링 결과 (${min} ~ ${max}): ${filtered.length}개`);

    if (filtered.length === 0) {
      return res.status(404).json({ error: "예산 범위에 맞는 CPU가 없습니다." });
    }

    const byPassmark = [...filtered]
      .filter(c => c.benchmarkScore?.passmarkscore)
      .sort((a, b) => b.benchmarkScore.passmarkscore - a.benchmarkScore.passmarkscore)
      .slice(0, 15);
    console.log("🏆 PassMark 상위 15개:", byPassmark.map(c => c.name));

    const byValue = [...filtered]
      .filter(c => c.benchmarkScore?.passmarkscore && c.price)
      .map(c => ({
        ...c,
        valueScore: c.benchmarkScore.passmarkscore / c.price,
      }))
      .sort((a, b) => b.valueScore - a.valueScore)
      .slice(0, 15);
    console.log("💰 가성비 상위 15개:", byValue.map(c => c.name));

    const cpuNames = [...new Set([...byPassmark, ...byValue].map(c => c.name))];
    console.log("📨 GPT에 전달할 CPU 모델명:", cpuNames);

    const gptResult = await askGPTWithModelNamesOnly(cpuNames);

    if (!gptResult) {
      console.warn("⚠️ GPT 결과 없음 또는 파싱 실패");
      return res.status(500).json({ error: "GPT 응답 파싱 실패" });
    }

    console.log("✅ GPT 추천 결과:", gptResult);
    return res.json({ recommended: gptResult });
  } catch (err) {
    console.error("❌ 전체 추천 처리 실패:", err);
    return res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
