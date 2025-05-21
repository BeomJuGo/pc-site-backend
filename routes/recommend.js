import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const askGPTForFullBuild = async (cpuList, gpuList, memoryList, boardList, budget) => {
  const formatPartList = (title, list) =>
    `${title} 후보 목록:\n` +
    list.map((p, i) => `${i + 1}. ${p.name} (가격: ${p.price.toLocaleString()}원)`).join("\n");

   const prompt = `사용자의 총 예산은 ${budget.toLocaleString()}원입니다. 
  아래 부품 후보 중에서 예산 내에서 최고의 PC를 구성해주세요. 예산의 최대5%까진 추천가능합니다.
  각 부품군(CPU, GPU, 메모리, 메인보드)마다 1개씩 선택해주세요.
  각 부품을 선택할 때는 성능, 가격, 가성비, 최신 세대 여부, 호환성 등을 고려하세요.
  선택 이유(reason)는 다음과 같이 구체적으로 작성해주세요:
  예시: "12코어 24스레드의 고성능을 제공하면서도 경쟁 제품 대비 저렴한 편이며, 영상 편집과 게임 모두에서 우수한 성능을 발휘합니다."
  \n\n${formatPartList("CPU", cpuList)}\n\n${formatPartList("GPU", gpuList)}\n\n${formatPartList("메모리", memoryList)}\n\n${formatPartList("메인보드", boardList)}\n\n아래 형식으로만 JSON으로 답변해주세요. 
  설명문은 절대 포함하지 마세요.
  \n{\n  \"cpu\": { \"name\": \"\", \"reason\": \"\" },
  \n  \"gpu\": { \"name\": \"\", \"reason\": \"\" },
  \n  \"memory\": { \"name\": \"\", \"reason\": \"\" },
  \n  \"mainboard\": { \"name\": \"\", \"reason\": \"\" },
  \n  \"totalPrice\": 숫자\n}`;

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
        max_tokens: 1000,
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

      partMap[category] = parts;
    }

    const gptResult = await askGPTForFullBuild(
      partMap.cpu || [],
      partMap.gpu || [],
      partMap.memory || [],
      partMap.mainboard || [],
      budget
    );

    if (!gptResult) {
      return res.status(500).json({ error: "GPT 응답 파싱 실패" });
    }

    const findWithDetail = (name, list) => {
      const found = list.find(p => p.name === name);
      if (!found) return { name, reason: "정보 없음" };
      return {
        _id: found._id,
        category: found.category,
        name: found.name,
        price: found.price,
        image: found.image,
        benchmarkScore: found.benchmarkScore,
        reason: gptResult[found.category]?.reason || "",
      };
    };

    const recommended = {
      cpu: findWithDetail(gptResult.cpu?.name, partMap.cpu || []),
      gpu: findWithDetail(gptResult.gpu?.name, partMap.gpu || []),
      memory: findWithDetail(gptResult.memory?.name, partMap.memory || []),
      mainboard: findWithDetail(gptResult.mainboard?.name, partMap.mainboard || []),
      totalPrice: gptResult.totalPrice,
    };

    console.log("✅ GPT 추천 결과:", recommended);
    return res.json({ recommended });
  } catch (err) {
    console.error("❌ 전체 추천 처리 실패:", err);
    return res.status(500).json({ error: "서버 오류" });
  }
});

export default router;
