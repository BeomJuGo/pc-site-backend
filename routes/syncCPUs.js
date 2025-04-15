// ✅ routes/syncCPUs.js
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
    if (name && score) cpus.push({ name, score });
  });
  return cpus;
}

// 2. 네이버 쇼핑에서 가격 가져오기
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

// 3. MongoDB에 저장
async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const collection = db.collection("parts");

  for (const cpu of cpus) {
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
        priceHistory: [
          {
            date: today,
            price: cpu.price || 0,
          },
        ],
      });
    }
  }
}

// 4. API 엔드포인트 구성
router.post("/sync-cpus", async (req, res) => {
  try {
    const rawList = await fetchGeekbenchCPUs();
    console.log("✅ CPU 목록 개수:", rawList.length);

    const enriched = [];

    for (const cpu of rawList.slice(0, 5)) {
      const price = await fetchNaverPrice(cpu.name);
      console.log(`💰 ${cpu.name} 가격:`, price);
      enriched.push({ ...cpu, price });
    }

    await saveCPUsToMongo(enriched);
    res.json({ success: true, count: enriched.length });
  } catch (err) {
    console.error("❌ CPU 동기화 실패:", err); // ← 여기를 수정!
    res.status(500).json({ error: "CPU 목록 저장 실패" });
  }
});

export default router;
