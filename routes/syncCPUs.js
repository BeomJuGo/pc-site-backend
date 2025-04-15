// ✅ routes/syncCPUs.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";
import { fetchGeekbenchCPUsCached } from "../utils/cpuCache.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// ✅ 네이버 쇼핑에서 가격 가져오기
async function fetchNaverPrice(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encoded}`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  const data = await res.json();
  const item = data.items?.[0];
  return item ? parseInt(item.lprice, 10) : null;
}

// ✅ MongoDB에 저장
async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const collection = db.collection("parts");

  for (const cpu of cpus) {
    try {
      const exists = await collection.findOne({ name: cpu.name });
      const today = new Date().toISOString().slice(0, 10);

      if (exists) {
        console.log("🔁 기존 CPU 업데이트:", cpu.name);
        await collection.updateOne(
          { _id: exists._id },
          {
            $set: {
              benchmarkScore: {
                singleCore: cpu.score,
                multiCore: cpu.score,
              },
              category: "cpu",
            },
            $push: {
              priceHistory: { date: today, price: cpu.price || 0 },
            },
          }
        );
      } else {
        console.log("🆕 새 CPU 삽입:", cpu.name);
        await collection.insertOne({
          category: "cpu",
          name: cpu.name,
          benchmarkScore: {
            singleCore: cpu.score,
            multiCore: cpu.score,
          },
          priceHistory: [
            {
              date: today,
              price: cpu.price || 0,
            },
          ],
        });
      }
    } catch (err) {
      console.error("❌ MongoDB 저장 중 오류:", err);
    }
  }
}

// ✅ API 엔드포인트 구성 (응답 먼저 반환 → 비동기 저장 + 캐싱 사용)
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 수집 시작됨 (백그라운드에서 처리 중)" });

  setImmediate(async () => {
    try {
      const rawList = await fetchGeekbenchCPUsCached(req.query.force === "true");
      console.log("✅ CPU 목록 개수:", rawList.length);

      const enriched = [];
      for (const cpu of rawList) {
        const price = await fetchNaverPrice(cpu.name);
        console.log(`💰 ${cpu.name} 가격:`, price);
        enriched.push({ ...cpu, price });
      }

      await saveCPUsToMongo(enriched);
      console.log("✅ 모든 CPU 저장 완료");
    } catch (err) {
      console.error("❌ CPU 동기화 실패:", err);
    }
  });
});

export default router;
