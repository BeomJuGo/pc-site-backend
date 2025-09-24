// routes/updatePrices.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

async function fetchNaverPriceAndImage(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encoded}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    console.error(`❌ 네이버 API 요청 실패: ${res.statusText}`);
    return null;
  }

  const json = await res.json();
  const items = json.items || [];

  // 디버깅 로그 출력
  console.log(`🔍 검색어: ${query}`);
  if (items.length === 0) {
    console.log("⛔ 네이버 검색 결과 없음");
    return null;
  }

  items.forEach((item, i) => {
    console.log(`📦 ${i + 1}. ${item.title} - ${item.lprice}원`);
  });

  const validPrices = items
    .map((item) => parseInt(item.lprice, 10))
    .filter((price) => !isNaN(price) && price >= 10000 && price <= 2000000)
    .sort((a, b) => a - b);

  if (validPrices.length === 0) {
    console.log("⛔ 가격 필터 통과 못함 (10000원 ~ 2000000원)");
    return null;
  }

  const midPrice = validPrices[Math.floor(validPrices.length / 2)];
  const firstImage = items[0]?.image || "";

  return { price: midPrice, image: firstImage };
}

router.post("/api/admin/update-prices", async (req, res) => {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  const parts = await col.find({
    category: { $in: ["cpu", "gpu", "motherboard", "memory"] },
  }).toArray();

  console.log(`📦 총 ${parts.length}개의 부품 가격 업데이트 시작`);

  for (const part of parts) {
    const result = await fetchNaverPriceAndImage(part.name);
    if (!result) {
      console.log(`⛔ 가격 가져오기 실패: ${part.name}`);
      continue;
    }

    const { price, image } = result;

    const priceEntry = { date: today, price };

    const updateFields = {
      price,
      image,
    };

    const already = (part.priceHistory || []).some((p) => p.date === today);
    const updateOps = {
      $set: updateFields,
    };
    if (!already) {
      updateOps.$push = { priceHistory: priceEntry };
    }

    await col.updateOne({ _id: part._id }, updateOps);
    console.log(`✅ 가격 업데이트 완료: ${part.name} → ${price}원`);
  }

  res.json({ message: "✅ 가격 업데이트 완료" });
});

export default router;
