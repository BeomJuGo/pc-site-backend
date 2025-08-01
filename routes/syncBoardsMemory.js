import express from "express";
import { fetchNaverPriceImage } from "../utils/naverShopping.js";
import Part from "../models/Part.js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

const GPT_API_KEY = process.env.OPENAI_API_KEY;

async function gptChat(prompt) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    },
    {
      headers: {
        Authorization: `Bearer ${GPT_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return res.data.choices[0].message.content;
}

function deduplicateParts(parts) {
  const seen = new Set();
  return parts.filter((p) => {
    const key = `${p.category}:${p.name.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchPartsFromGPT(category) {
  const prompt = `
당신은 PC부품에 관한 전문가입니다. 현재 국내에 유통되고 있으며 가장 인기가 좋은 ${category === "memory" ? "메모리" : "메인보드"} 목록을 JSON으로 반환해주세요.

형식:
[
  {
    "category": "${category}",
    "name": "제품명",
    "info": "주요 사양 (칩셋/폼팩터 또는 용량/클럭 등)"
  }
]

⚠️ 출력 시 마크다운 코드 블록(\`\`\`) 없이 순수 JSON만 반환해주세요.
중복되는 항목은 제거하고, 인기 있는 브랜드 위주로 구성해주세요.
`;

  const raw = await gptChat(prompt);

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("❌ GPT JSON 파싱 실패:", e.message);
    console.error("GPT 응답:", cleaned);
    return [];
  }
}

async function enrichPartsWithPrice(parts) {
  const MIN_PRICE = 150000;
  const MAX_PRICE = 800000;

  const enriched = [];

  for (const part of parts) {
    try {
      const { price, image } = await fetchNaverPriceImage(part.name);

      if (price < MIN_PRICE || price > MAX_PRICE) {
        console.log(`⚠️ [${part.name}] 가격 필터링됨: ${price}`);
        continue;
      }

      enriched.push({
        ...part,
        price,
        image,
      });
    } catch (e) {
      console.error(`❌ [${part.name}] 가격 정보 실패:`, e.message);
    }
  }

  return enriched;
}

router.post("/api/sync-boards-memory", async (req, res) => {
  try {
    console.log("🔄 GPT 메인보드·메모리 목록 생성 중...");

    const boards = await fetchPartsFromGPT("motherboard");
    const memory = await fetchPartsFromGPT("memory");

    const all = deduplicateParts([...boards, ...memory]);

    console.log(`✅ GPT 결과 총 ${all.length}개`);

    const enriched = await enrichPartsWithPrice(all);
    console.log(`✅ 가격 필터링 후 ${enriched.length}개 저장`);

    for (const part of enriched) {
      await Part.updateOne(
        { category: part.category, name: part.name },
        { $set: part },
        { upsert: true }
      );
    }

    res.json({ inserted: enriched.length });
  } catch (e) {
    console.error("❌ 전체 동기화 실패:", e.message);
    res.status(500).json({ error: "동기화 중 오류 발생" });
  }
});

export default router;
