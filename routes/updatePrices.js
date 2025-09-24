// routes/updatePrices.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

/**
 * 네이버 쇼핑에서 가격/이미지를 가져옵니다.
 * 카테고리별 최소 가격을 다르게 지정하고, 불필요한 키워드는 공통적으로 제거합니다.
 */
async function fetchNaverPrice(name, category) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(
    name
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
    // 공통 제외 키워드: 중고/리퍼/쿨러/팬/방열/파워 등
    if (
      /리퍼|중고|쿨러|팬|방열|워터|수랭|라디에이터|블록|파워|램|케이스|케이블|어댑터|방열판|워터블럭|워터블록/i.test(
        title
      )
    )
      continue;
    const price = parseInt(item.lprice, 10);
    // 카테고리별 최소·최대 가격 설정
    let minPrice = 10000;
    let maxPrice = 5000000;
    if (category === "gpu") minPrice = 150000; // GPU는 보통 더 비싸므로 하한을 높임

    if (isNaN(price) || price < minPrice || price > maxPrice) continue;

    prices.push(price);
    if (!image) image = item.image;
  }

  if (prices.length === 0) return null;

  // 중앙값 계산
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid];

  return { price: median, image };
}

// 가격/이미지 갱신 라우터: POST /api/update-prices
router.post("/", async (req, res) => {
  try {
    const db = getDB();
    const col = db.collection("parts");
    const parts = await col.find({}).toArray();
    const today = new Date().toISOString().slice(0, 10);

    for (const part of parts) {
      const result = await fetchNaverPrice(part.name, part.category);
      if (!result) {
        console.log("⛔ 가격 정보 없음:", part.name);
        continue;
      }

      const { price, image } = result;
      const priceEntry = { date: today, price };
      const already = (part.priceHistory || []).some(
        (p) => p.date === today
      );

      await col.updateOne(
        { _id: part._id },
        {
          $set: { price, image },
          ...(already ? {} : { $push: { priceHistory: priceEntry } }),
        }
      );
      console.log("💰 가격 업데이트:", part.name);
    }

    res.json({ message: "✅ 가격 업데이트 완료" });
  } catch (err) {
    console.error("❌ 가격 업데이트 실패", err);
    res.status(500).json({ error: "가격 업데이트 실패" });
  }
});

export default router;
