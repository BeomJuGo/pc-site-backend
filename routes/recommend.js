import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// GPT에 견적 요청
const askGPTForFullBuild = async (cpuList, gpuList, memoryList, boardList, budget) => {
  const formatPartList = (title, list) =>
    `${title} 후보 목록:\n` +
    list.map((p, i) => `${i + 1}. ${p.name} (가격: ${p.price.toLocaleString()}원)`).join("\n");

  const prompt = `사용자의 총 예산은 ${budget.toLocaleString()}원입니다.
예산의 최대 5% 초과까지만 허용됩니다.
각 부품군(CPU, GPU, 메모리, 메인보드)에서 후보 1개씩 추천해주세요.
성능, 가성비, 세대, 호환성을 종합적으로 고려하고,
아래 형식으로만 JSON으로 답변해주세요. 설명문은 절대 포함하지 마세요.

${formatPartList("CPU", cpuList)}
${formatPartList("GPU", gpuList)}
${formatPartList("메모리", memoryList)}
${formatPartList("메인보드", boardList)}

{
  "cpu": { "name": "", "reason": "" },
  "gpu": { "name": "", "reason": "" },
  "memory": { "name": "", "reason": "" },
  "mainboard": { "name": "", "reason": "" },
  "totalPrice": 숫자
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
          { role: "system", content: "너는 PC 견적 추천 전문가야." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    console.log("🧠 GPT 응답 원문:\n", raw);

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    return JSON.parse(raw.slice(start, end));
  } catch (err) {
    console.error("❌ GPT 요청 실패:", err);
    return null;
  }
};

router.post("/", async (req, res) => {
  console.log("🔔 [추천 API 호출됨] POST /api/recommend");
  const { budget } = req.body;
  if (!budget) return res.status(400).json({ error: "예산이 필요합니다." });

  try {
    const db = await getDB();
    const partsCol = db.collection("parts");
    const categories = ["cpu", "gpu", "memory", "mainboard"];
    const partMap = {};

    for (const category of categories) {
      const parts = await partsCol
        .find({ category, price: { $lte: budget * 0.7 }, "benchmarkScore.passmarkscore": { $exists: true } })
        .sort({ "benchmarkScore.passmarkscore": -1 })
        .limit(15)
        .toArray();
      partMap[category] = parts.map(p => ({ name: p.name, price: p.price }));
    }

    const gptResult = await askGPTForFullBuild(
      partMap.cpu,
      partMap.gpu,
      partMap.memory,
      partMap.mainboard,
      budget
    );

    if (!gptResult) return res.status(500).json({ error: "GPT 응답 파싱 실패" });

    // ✅ GPT가 추천한 부품명을 기준으로 DB에서 다시 상세정보 가져오기
    const getDetailedPart = async (name) => {
      if (!name || name === "정보 없음") return { name: "정보 없음" };
      const part = await partsCol.findOne({ name });
      if (!part) return { name, reason: "정보 없음" };
      return {
        _id: part._id,
        category: part.category,
        name: part.name,
        image: part.image,
        price: part.price,
        benchmarkScore: part.benchmarkScore,
        reason: gptResult[part.category]?.reason || "",
      };
    };

    const recommended = {
      cpu: await getDetailedPart(gptResult.cpu?.name),
      gpu: await getDetailedPart(gptResult.gpu?.name),
      memory: await getDetailedPart(gptResult.memory?.name),
      mainboard: await getDetailedPart(gptResult.mainboard?.name),
      totalPrice: gptResult.totalPrice,
    };

    console.log("✅ 최종 추천 결과:", recommended);
    return res.json({ recommended });
  } catch (err) {
    console.error("❌ 전체 추천 처리 실패:", err);
    return res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
