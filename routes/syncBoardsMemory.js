// routes/syncBoardsMemory.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ GPT로 인기 메인보드·메모리 목록 가져오기
async function fetchPartsFromGPT() {
  const prompt = `당신은 PC부품에 관한 전문가입니다.
현재 국내에 유통되고 있으며 가장 인기가 좋은 메인보드와 메모리들의 목록을 JSON으로 반환해주세요.
각 항목은 { "category": "motherboard" 또는 "memory", "name": 제품명, "info": 주요 사양(칩셋/폼팩터 또는 용량/클럭, 기타 특징) } 형식으로 작성해 주세요.
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
        temperature: 0.5,
      }),
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "[]";
    return JSON.parse(content);
  } catch (e) {
    console.error("❌ GPT 호출 실패:", e);
    return [];
  }
}

// ✅ 네이버 쇼핑에서 가격과 이미지 가져오기 (필터링/중앙값 사용)
async function fetchNaverPriceImage(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  const data = await res.json();

  const prices = [];
  let image = null;
  for (const item of data.items || []) {
    const title = item.title.replace(/<[^>]*>/g, "");
    // 주변 부품 제외
    if (
      /리퍼|중고|쿨러|팬|방열|라디에이터|워터블럭|케이스|케이블|어댑터/i.test(title)
    )
      continue;
    const price = parseInt(item.lprice, 10);
    if (isNaN(price) || price < 10000 || price > 5000000) continue;
    prices.push(price);
    if (!image) image = item.image;
  }
  if (prices.length === 0) return null;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid];
  return { price: median, image };
}

// ✅ MongoDB에 저장
async function saveToDB(parts) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  const existing = await col
    .find({ category: { $in: ["motherboard", "memory"] } })
    .toArray();
  const currentNames = new Set(parts.map((p) => p.name));

  for (const part of parts) {
    const old = existing.find(
      (e) => e.name === part.name && e.category === part.category
    );
    const priceEntry = { date: today, price: part.price };
    const update = {
      category: part.category,
      info: part.info,
      price: part.price,
      image: part.image,
    };
    if (old) {
      const already = (old.priceHistory || []).some((p) => p.date === today);
      await col.updateOne(
        { _id: old._id },
        {
          $set: update,
          ...(already ? {} : { $push: { priceHistory: priceEntry } }),
        }
      );
      console.log("🔁 업데이트됨:", part.name);
    } else {
      await col.insertOne({
        name: part.name,
        ...update,
        priceHistory: [priceEntry],
      });
      console.log("🆕 삽입됨:", part.name);
    }
  }

  // 기존에 있었지만 이번 목록에 없는 항목 삭제
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({
      category: { $in: ["motherboard", "memory"] },
      name: { $in: toDelete },
    });
    console.log("🗑️ 삭제됨:", toDelete.length, "개");
  }
}

// ✅ 실행 라우터: '/api/sync-boards-memory' 접두사가 붙습니다.
router.post("/", (req, res) => {
  res.json({ message: "✅ 메인보드·메모리 동기화 시작됨" });
  setImmediate(async () => {
    const gptParts = await fetchPartsFromGPT();
    const enriched = [];
    for (const part of gptParts) {
      const priceData = await fetchNaverPriceImage(part.name);
      if (!priceData) {
        console.log("⛔ 제외 (가격 찾지 못함):", part.name);
        continue;
      }
      enriched.push({ ...part, ...priceData });
    }
    await saveToDB(enriched);
    console.log("🎉 메인보드·메모리 저장 완료");
  });
});

export default router;
