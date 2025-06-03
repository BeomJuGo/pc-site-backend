import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 이름 정제
const cleanName = (raw) =>
  raw.split("\n")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/®|™/gi, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 중복 여부 판단
const isDuplicate = (name, set) => {
  const base = name.replace(/\s+super|\s+ti|\s+xt|\s+pro/gi, "").toLowerCase();
  if (set.has(base)) return true;
  set.add(base);
  return false;
};

// 비주류 필터링
const isUnwanted = (name) =>
  /rtx\s*4500|radeon\s*pro\s*w7700/i.test(name);

// GPU 벤치마크 크롤링
async function fetchGPUsFromTopCPU() {
  const url = "https://www.topcpu.net/ko/gpu-r/3dmark-time-spy-desktop";
  const html = await axios.get(url).then(res => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];
  const nameSet = new Set();

  $("table tbody tr").each((_, el) => {
    const tds = $(el).find("td");
    const rawName = tds.eq(1).text().trim();
    const rawScore = tds.eq(2).text().trim();
    console.log("원본:", rawName, "| 점수:", rawScore);

    const name = cleanName(rawName);
    const score = parseInt(rawScore.replace(/,/g, ""), 10);

    if (!name || isNaN(score)) return;
    if (score < 10000) return console.log("⛔ 제외 (점수 낮음):", name);
    if (isUnwanted(name)) return console.log("⛔ 제외 (비주류):", name);
    if (isDuplicate(name, nameSet)) return console.log("⛔ 제외 (중복):", name);

    gpuList.push({ name, score });
  });

  console.log("✅ 크롤링 완료, 유효 GPU 수:", gpuList.length);
  return gpuList;
}

// 네이버 가격 + 이미지
async function fetchNaverPrice(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  const data = await res.json();
  const item = data.items?.[0];
  return item ? { price: parseInt(item.lprice, 10), image: item.image || "" } : null;
}

// GPT 요약
async function fetchGptSummary(name) {
  const [reviewPrompt, specPrompt] = [
    `${name} 그래픽카드의 장점과 단점을 각각 한 문장으로 알려줘. 형식: '장점: ..., 단점: ...'`,
    `${name} 그래픽카드의 VRAM, 클럭, 쿠다코어, 전력 등 주요 사양을 요약해줘.`,
  ];

  try {
    const [reviewRes, specRes] = await Promise.all([
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: reviewPrompt }], max_tokens: 200 }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: specPrompt }], max_tokens: 200 }),
      }),
    ]);
    const review = (await reviewRes.json()).choices?.[0]?.message?.content || "";
    const spec = (await specRes.json()).choices?.[0]?.message?.content || "";
    return { review, specSummary: spec };
  } catch (e) {
    return { review: "", specSummary: "" };
  }
}

// MongoDB 저장
async function saveGPUsToMongo(gpus) {
  const db = getDB();
  const collection = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  const currentNames = new Set(gpus.map(g => g.name));
  const existing = await collection.find({ category: "gpu" }).toArray();

  for (const gpu of gpus) {
    const existingItem = existing.find(e => e.name === gpu.name);
    const priceEntry = { date: today, price: gpu.price };

    const updateFields = {
      category: "gpu",
      price: gpu.price,
      benchmarkScore: { score: gpu.score },
      image: gpu.image,
      review: gpu.review,
      specSummary: gpu.specSummary,
    };

    if (existingItem) {
      const alreadyLogged = (existingItem.priceHistory || []).some(p => p.date === today);
      await collection.updateOne(
        { _id: existingItem._id },
        {
          $set: updateFields,
          ...(alreadyLogged ? {} : { $push: { priceHistory: priceEntry } }),
        }
      );
      console.log("🔁 업데이트:", gpu.name);
    } else {
      await collection.insertOne({
        name: gpu.name,
        ...updateFields,
        priceHistory: [priceEntry],
      });
      console.log("🆕 삽입됨:", gpu.name);
    }
  }

  // 🔻 필터에서 제외된 GPU는 삭제
  const toDelete = existing
    .filter(e => !currentNames.has(e.name))
    .map(e => e.name);
  if (toDelete.length) {
    await collection.deleteMany({ name: { $in: toDelete }, category: "gpu" });
    console.log("🗑️ 삭제됨:", toDelete.length, "개");
  }
}

// 라우터 등록
router.post("/sync-gpus", (req, res) => {
  res.json({ message: "✅ GPU 동기화 시작됨" });
  setImmediate(async () => {
    const raw = await fetchGPUsFromTopCPU();
    const enriched = [];

    for (const gpu of raw) {
      const price = await fetchNaverPrice(gpu.name);
      if (!price || price.price < 10000 || price.price > 3000000) {
        console.log("⛔ 제외 (가격 문제):", gpu.name);
        continue;
      }
      const gpt = await fetchGptSummary(gpu.name);
      enriched.push({ ...gpu, ...price, ...gpt });
    }

    await saveGPUsToMongo(enriched);
    console.log("🎉 모든 GPU 저장 완료");
  });
});

export default router;
