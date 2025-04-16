// ✅ routes/syncCPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 이름 정제
const cleanName = (raw) => raw.split("\n")[0].split("(")[0].trim();

// ✅ Geekbench 점수 크롤링
async function fetchGeekbenchScores() {
  const url = "https://browser.geekbench.com/processor-benchmarks";
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);

  const cpuMap = {};

  $("table tbody tr").each((_, row) => {
    const name = $(row).find("td").eq(0).text().trim();
    const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
    if (!name || isNaN(score)) return;
    if (!cpuMap[name]) cpuMap[name] = [];
    cpuMap[name].push(score);
  });

  const cpus = [];

  for (const [name, scores] of Object.entries(cpuMap)) {
    const single = Math.min(...scores);
    const multi = Math.max(...scores);

    const isTooOld = /Pentium|Celeron|Atom|E1-|E2-|A4-|A6-|A8-|Sempron|Turion|Core 2|i3-[1-4]|i5-[1-4]|i7-[1-4]/i.test(name);
    const isTooWeak = single < 2000;
    const isWeirdFormat = !(name.includes("GHz") || /\(.*\)/.test(name));
    const isLaptopModel = /AMD Ryzen.*\d+(HX|HS|H|U)\b|Intel Core.*\d+(HX|H|E)\b/i.test(name);
    const isZSeries = /Ryzen\s+Z\d|Z1/i.test(name);
    if (isTooOld || isTooWeak || isWeirdFormat || isLaptopModel || isZSeries) continue;

    cpus.push({ name: cleanName(name), singleCore: single, multiCore: multi });
  }

  console.log(`🧩 Geekbench 전체 CPU: ${Object.keys(cpuMap).length}개`);
  console.log(`✅ 필터 통과 CPU: ${cpus.length}개`);
  return cpus;
}

// ✅ 네이버 가격 크롤링
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
  return item
    ? {
        price: parseInt(item.lprice, 10),
        image: item.image || "",
      }
    : null;
}

// ✅ GPT 요약
async function fetchGptSummary(name) {
  const reviewPrompt = `${name}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;
  const specPrompt = `${name}의 주요 사양을 요약해서 알려줘. 코어 수, 스레드 수, 클럭 위주로.`;

  try {
    const [reviewRes, specRes] = await Promise.all([
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: reviewPrompt }],
          max_tokens: 200,
        }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: specPrompt }],
          max_tokens: 200,
        }),
      }),
    ]);

    const reviewData = await reviewRes.json();
    const specData = await specRes.json();

    return {
      review: reviewData.choices?.[0]?.message?.content || "",
      specSummary: specData.choices?.[0]?.message?.content || "",
    };
  } catch (e) {
    console.error("❌ GPT 오류:", e.message);
    return { review: "", specSummary: "" };
  }
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
          multiCore: cpu.multiCore,
        },
        review: cpu.review || "",
        specSummary: cpu.specSummary || "",
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

// ✅ 필터 조건에 맞지 않는 기존 DB 삭제
async function deleteLowValueCPUs() {
  const db = getDB();
  const collection = db.collection("parts");

  const condition = {
    category: "cpu",
    $or: [
      { "benchmarkScore.singleCore": { $lt: 2000 } },
      { name: /Pentium|Celeron|Atom|E1-|E2-|A4-|A6-|A8-|Sempron|Turion|Core 2|i[3-5-7]-[1-4]/i },
      { name: /AMD Ryzen.*\d+(HX|HS|H|U)\b|Intel Core.*\d+(HX|H|E)\b/i },
      { name: /Ryzen\s+Z\d|Z1/i },
    ],
  };

  const toDelete = await collection.find(condition).toArray();
  const count = toDelete.length;
  const names = toDelete.map((cpu) => cpu.name);

  if (count > 0) {
    await collection.deleteMany({ _id: { $in: toDelete.map((cpu) => cpu._id) } });
    console.log(`🗑️ 삭제된 CPU 수: ${count}`);
    console.log("🗑️ 삭제된 이름 목록:", names);
  }
}

// ✅ API 엔드포인트
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 수집 시작됨 (백그라운드 처리 중)" });

  setImmediate(async () => {
    try {
      const rawList = await fetchGeekbenchScores();
      const enriched = [];

      for (const cpu of rawList) {
        const priceObj = await fetchNaverPrice(cpu.name);
        if (!priceObj || priceObj.price < 10000 || priceObj.price > 2000000) continue;

        const valueScore = cpu.multiCore / priceObj.price;
        if (valueScore < 0.02) continue;

        const gpt = await fetchGptSummary(cpu.name);
        enriched.push({ ...cpu, ...priceObj, ...gpt });
        console.log(`💰 ${cpu.name}: ${priceObj.price}원`);
      }

      await saveCPUsToMongo(enriched);
      await deleteLowValueCPUs();
      console.log("✅ 전체 동기화 완료");
    } catch (err) {
      console.error("❌ 전체 동기화 실패:", err);
    }
  });
});

export default router;
