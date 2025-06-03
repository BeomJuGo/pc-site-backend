// ✅ routes/syncGPUs.js
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
const cleanName = (raw) =>
  raw.split("\n")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/®|™|GPU|Graphics|GEFORCE|RADEON/gi, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ✅ GPU 벤치마크 크롤링
async function fetchGPUsFromTechMons() {
  const url = "https://tech-mons.com/gpu-ranking/";
  const html = await axios.get(url).then((res) => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];

  $("table tbody tr").each((_, el) => {
    const tds = $(el).find("td");
    const name = cleanName(tds.eq(1).text().trim());
    const score = parseInt(tds.eq(2).text().replace(/,/g, ""), 10);
    if (!name || isNaN(score)) return;
    if (score < 5000) {
      console.log("⛔ 제외 (점수 낮음):", name);
      return;
    }
    gpuList.push({ name, passmarkscore: score });
  });

  console.log("✅ 필터링된 GPU 수:", gpuList.length);
  return gpuList;
}

// ✅ 네이버 가격 + 이미지 크롤링
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
  return item ? { price: parseInt(item.lprice, 10), image: item.image || "" } : null;
}

// ✅ GPT 요약
async function fetchGptSummary(name) {
  const [reviewPrompt, specPrompt] = [
    `${name} 그래픽카드의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`,
    `${name} 그래픽카드의 주요 사양을 요약해줘. VRAM, 클럭, 쿠다코어, 전력 위주로.`,
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
    const reviewData = await reviewRes.json();
    const specData = await specRes.json();
    return {
      review: reviewData.choices?.[0]?.message?.content || "",
      specSummary: specData.choices?.[0]?.message?.content || "",
    };
  } catch (e) {
    return { review: "", specSummary: "" };
  }
}

// ✅ MongoDB 저장
async function saveGPUsToMongo(gpus) {
  const db = getDB();
  const collection = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  for (const gpu of gpus) {
    const existing = await collection.findOne({ name: gpu.name });

    const updateFields = {
      category: "gpu",
      price: gpu.price,
      benchmarkScore: {
        passmarkscore: gpu.passmarkscore,
      },
      review: gpu.review || "",
      specSummary: gpu.specSummary || "",
      image: gpu.image || "",
    };

    const priceEntry = { date: today, price: gpu.price || 0 };

    if (existing) {
      const alreadyLogged = (existing.priceHistory || []).some(
        (h) => String(h.date) === today
      );
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: updateFields,
          ...(alreadyLogged ? {} : { $push: { priceHistory: priceEntry } }),
        }
      );
      console.log(`🔁 업데이트됨: ${gpu.name} (${alreadyLogged ? "가격 기록 있음" : "새 가격 추가됨"})`);
    } else {
      await collection.insertOne({
        name: gpu.name,
        ...updateFields,
        priceHistory: [priceEntry],
      });
      console.log("🆕 새로 삽입됨:", gpu.name);
    }
  }
}

// ✅ 라우터 등록
router.post("/sync-gpus", (req, res) => {
  res.json({ message: "✅ GPU 동기화 시작됨 (백그라운드에서 처리 중)" });
  setImmediate(async () => {
    const rawList = await fetchGPUsFromTechMons();
    const enriched = [];
    for (const gpu of rawList) {
      const priceData = await fetchNaverPrice(gpu.name);
      if (!priceData || priceData.price < 10000 || priceData.price > 3000000) {
        console.log("⛔ 제외 (가격 없음/이상치):", gpu.name);
        continue;
      }
      const gpt = await fetchGptSummary(gpu.name);
      enriched.push({ ...gpu, ...priceData, ...gpt });
    }
    await saveGPUsToMongo(enriched);
    console.log("🎉 모든 GPU 저장 완료");
  });
});

export default router;
