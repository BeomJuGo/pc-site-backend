// ✅ routes/syncCPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// ✅ 이름 정제 함수
const cleanName = (raw) => raw.split("\n")[0].split("(")[0].trim();

// ✅ Geekbench 점수 크롤링 (싱글/멀티)
async function fetchGeekbenchScores() {
  const urls = {
    single: "https://browser.geekbench.com/processor-benchmarks",
    multi: "https://browser.geekbench.com/processor-benchmarks?baseline=multi"
  };

  const results = {};

  for (const [type, url] of Object.entries(urls)) {
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    $("table tbody tr").each((_, row) => {
      const name = $(row).find("td").eq(0).text().trim();
      const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
      if (!name || isNaN(score)) return;

      if (!results[name]) results[name] = {};
      results[name][type] = score;
    });
  }

  const cpus = [];
  for (const [name, scoreObj] of Object.entries(results)) {
    const single = scoreObj.single || 0;
    const multi = scoreObj.multi || 0;

    const isTooOld = /Pentium|Celeron|Atom|E1-|E2-|A4-|A6-|A8-|Sempron|Turion|Core 2|i3-[1-4]|i5-[1-4]|i7-[1-4]/i.test(name);
    const isTooWeak = single < 2000;
    const isWeirdFormat = /(GHz|\(.*\))/.test(name) === false;

    if (isTooOld || isTooWeak || isWeirdFormat) continue;

    cpus.push({ name: cleanName(name), singleCore: single, multiCore: multi });
  }

  console.log(`🧩 Geekbench 총 CPU 목록: ${Object.keys(results).length}개`);
  console.log(`✅ 필터 통과한 CPU 수: ${cpus.length}개`);

  return cpus;
}

// ✅ 네이버 가격
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

// ✅ MongoDB 저장
async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const collection = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  for (const cpu of cpus) {
    try {
      const exists = await collection.findOne({ name: cpu.name });

      const doc = {
        category: "cpu",
        name: cpu.name,
        benchmarkScore: {
          singleCore: cpu.singleCore,
          multiCore: cpu.multiCore
        },
      };

      if (exists) {
        await collection.updateOne(
          { _id: exists._id },
          {
            $set: doc,
            $push: {
              priceHistory: { date: today, price: cpu.price || 0 },
            },
          }
        );
        console.log("🔁 업데이트:", cpu.name);
      } else {
        await collection.insertOne({
          ...doc,
          priceHistory: [{ date: today, price: cpu.price || 0 }],
        });
        console.log("🆕 삽입:", cpu.name);
      }
    } catch (err) {
      console.error("❌ 저장 오류:", err);
    }
  }
}

// ✅ 엔드포인트
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 수집 시작됨 (백그라운드 처리 중)" });

  setImmediate(async () => {
    try {
      const cpuList = await fetchGeekbenchScores();

      const enriched = [];
      for (const cpu of cpuList) {
        const price = await fetchNaverPrice(cpu.name);
        const isValid = price !== null && price > 10000;
        if (!isValid) continue;

        console.log(`💰 ${cpu.name} 가격:`, price);
        enriched.push({ ...cpu, price });
      }

      await saveCPUsToMongo(enriched);
      console.log("✅ CPU 저장 완료");
    } catch (err) {
      console.error("❌ 동기화 실패:", err);
    }
  });
});

export default router;
