import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 강화된 GPT 프롬프트
async function fetchPartsFromGPT() {
  const prompt = `당신은 PC 부품 전문가입니다.
대한민국에서 2025년 현재 유통 중인 인기 메모리(RAM) 및 메인보드(Motherboard) 제품들을
카테고리당 **20개 이상** JSON 배열로 반환해주세요.
각 항목은 다음 형식:
{
  "category": "memory" 또는 "motherboard",
  "name": "정확한 제품 전체명 (예: G.SKILL DDR5 6400 CL32 32GB)",
  "info": "주요 사양 요약 (예: DDR5 / 6400MHz / 32GB / CL32)"
}
– 가격은 포함하지 마세요.
– 아래 브랜드의 인기 모델을 포함해주세요:
  메모리: 삼성전자, G.SKILL, Corsair, TeamGroup, Crucial
  메인보드: ASUS, MSI, Gigabyte, ASRock`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "[]";
    const rawList = JSON.parse(text);

    // ✅ 중복 제거 및 정제
    const seen = new Set();
    const cleaned = rawList.filter(part => {
      const key = `${part.category}|${part.name.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return cleaned;
  } catch (err) {
    console.error("❌ GPT 호출 오류", err);
    return [];
  }
}

// ✅ 네이버 가격/이미지 fetch with 중앙값 & 필터
async function fetchNaverPriceImage(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
    }
  });
  const data = await res.json();
  const prices = [];
  let image = null;

  for (const item of data.items || []) {
    const title = item.title.replace(/<[^>]*>/g, "");
    if (/리퍼|중고|쿨러|팬|케이스|케이블|어댑터/i.test(title)) continue;
    const price = parseInt(item.lprice, 10);
    if (isNaN(price) || price < 10000 || price > 5000000) continue;
    prices.push(price);
    if (!image) image = item.image;
  }

  if (!prices.length) return null;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid];

  return { price: median, image };
}

async function saveToDB(parts) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  const existing = await col
    .find({ category: { $in: ["motherboard", "memory"] } })
    .toArray();

  const currentNames = new Set(parts.map(p => p.name.trim()));

  for (const p of parts) {
    const old = existing.find(
      e => e.name === p.name && e.category === p.category
    );
    const priceEntry = { date: today, price: p.price };
    const update = {
      category: p.category,
      info: p.info,
      price: p.price,
      image: p.image
    };

    if (old) {
      const already = (old.priceHistory || []).some(a => a.date === today);
      await col.updateOne(
        { _id: old._id },
        { $set: update, ...(already ? {} : { $push: { priceHistory: priceEntry } }) }
      );
      console.log("🔁 업데이트됨:", p.name);
    } else {
      await col.insertOne({
        name: p.name,
        ...update,
        priceHistory: [priceEntry]
      });
      console.log("🆕 삽입됨:", p.name);
    }
  }

  const toDel = existing
    .filter(e => !currentNames.has(e.name))
    .map(e => e.name);
  if (toDel.length) {
    await col.deleteMany({
      category: { $in: ["motherboard", "memory"] },
      name: { $in: toDel }
    });
    console.log("🗑️ 삭제됨:", toDel.length);
  }
}

router.post("/", (req, res) => {
  res.json({ message: "✅ 동기화 시작됨 (메인보드 & 메모리)" });
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
    console.log("🎉 메인보드·메모리 DB 업데이트 완료");
  });
});

export default router;
