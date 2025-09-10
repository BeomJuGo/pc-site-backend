import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// GPT를 통해 인기 메모리와 메인보드 목록 가져오기
async function fetchPartsFromGPT() {
  const prompt = `당신은 PC 부품 전문가입니다.
대한민국에서 2025년 현재 유통 중인 인기 메모리(RAM) 및 메인보드(Motherboard) 제품들을
카테고리당 20개 이상 JSON 배열로 반환해주세요.
각 항목은 {
  "category": "memory" 또는 "motherboard",
  "name": "정확한 제품 전체명",
  "info": "주요 사양 요약"
}
형식으로 작성해 주세요.
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
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "[]";
    return JSON.parse(text);
  } catch (err) {
    console.error("❌ GPT 호출 오류", err);
    return [];
  }
}

// 네이버 쇼핑에서 가격과 이미지 가져오기 (중앙값 사용)
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
    if (
      /리퍼|중고|쿨러|팬|케이스|케이블|어댑터|방열|라디에이터|워터블럭/i.test(
        title
      )
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

// MongoDB 저장
async function saveToDB(parts) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  const existing = await col
    .find({ category: { $in: ["motherboard", "memory"] } })
    .toArray();
  const currentNames = new Set(parts.map((p) => p.name));

  for (const p of parts) {
    const old = existing.find(
      (e) => e.name === p.name && e.category === p.category
    );
    const priceEntry = { date: today, price: p.price };
    const update = {
      category: p.category,
      info: p.info,
      price: p.price,
      image: p.image,
    };
    if (old) {
      const already = (old.priceHistory || []).some((h) => h.date === today);
      await col.updateOne(
        { _id: old._id },
        { $set: update, ...(already ? {} : { $push: { priceHistory: priceEntry } }) }
      );
      console.log("🔁 업데이트됨:", p.name);
    } else {
      await col.insertOne({
        name: p.name,
        ...update,
        priceHistory: [priceEntry],
      });
      console.log("🆕 삽입됨:", p.name);
    }
  }

  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);
  if (toDelete.length) {
    await col.deleteMany({
      category: { $in: ["motherboard", "memory"] },
      name: { $in: toDelete },
    });
    console.log("🗑️ 삭제됨:", toDelete.length);
  }
}

// 실행 라우터
router.post("/", (req, res) => {
  res.json({ message: "✅ 메인보드·메모리 동기화 시작됨" });
  setImmediate(async () => {
    const rawList = await fetchPartsFromGPT();
    const enriched = [];
    for (const part of rawList) {
      const priceImg = await fetchNaverPriceImage(part.name);
      if (!priceImg) {
        console.log("⛔ 가격 못 찾음:", part.name);
        continue;
      }
      enriched.push({ ...part, ...priceImg });
    }
    await saveToDB(enriched);
    console.log("🎉 메인보드·메모리 저장 완료");
  });
});

export default router;
