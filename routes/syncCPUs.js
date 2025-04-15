import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// 1. Geekbench에서 CPU 목록 + 점수 크롤링
async function fetchGeekbenchCPUs() {
  const url = "https://browser.geekbench.com/processor-benchmarks";
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const cpus = [];

  $("table tbody tr").each((_, row) => {
    const name = $(row).find("td").eq(0).text().trim();
    const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);

    if (!name || !score) return;

    // ✅ 필터 조건
    const isTooOld = /Pentium|Celeron|Atom|E1-|E2-|A4-|A6-|A8-|Sempron|Turion|Core 2|i3-[1-4]|i5-[1-4]|i7-[1-4]/i.test(name);
    const isTooWeak = score < 2000;
    const isWeirdFormat = /\(.*\)|GHz/i.test(name) === false;

    if (isTooOld || isTooWeak || isWeirdFormat) return;

    cpus.push({ name, score });
  });

  return cpus;
}

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
  const price = item ? parseInt(item.lprice, 10) : null;

  const ignored = [
    "Pentium", "Celeron", "Core2", "Athlon", "Turion", "Sempron", "Opteron", "Phenom", "Xeon X"
  ];
  const isIgnored = ignored.some(keyword => query.includes(keyword));

  if (!price || isNaN(price) || price < 30000 || isIgnored) return null;
  return price;
}

async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const collection = db.collection("parts");

  for (const cpu of cpus) {
    try {
      const exists = await collection.findOne({ name: cpu.name });
      const today = new Date().toISOString().slice(0, 10);

      if (exists) {
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
        await collection.insertOne({
          category: "cpu",
          name: cpu.name,
          benchmarkScore: {
            singleCore: cpu.score,
            multiCore: cpu.score,
          },
          priceHistory: [{ date: today, price: cpu.price || 0 }],
        });
      }
    } catch (err) {
      console.error("❌ MongoDB 저장 중 오류:", err);
    }
  }
}

router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 수집 시작됨 (백그라운드에서 처리 중)" });

  setImmediate(async () => {
    try {
      const rawList = await fetchGeekbenchCPUs();
      console.log("✅ CPU 목록 개수:", rawList.length);

      const enriched = [];
      for (const cpu of rawList) {
        const price = await fetchNaverPrice(cpu.name);
        if (price === null) {
          console.log("🚫 필터링된 CPU:", cpu.name);
          continue;
        }

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
