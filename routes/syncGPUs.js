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

// ✅ GPU 이름 정제
const simplifyForNaver = (name) => {
  const simplified = name
    .replace(/NVIDIA GeForce |AMD Radeon /gi, "")
    .replace(/\b(TI|XT|SUPER|PRO|Ultra|GA\d+)\b/gi, " $1")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
  return simplified;
};

// ✅ 이름 형식 필터
const isValidGPUName = (name) => {
  const rtxPattern = /^RTX \d{4}( (TI|SUPER)( SUPER)?( \d+ GB)?)?$/i;
  const rxPattern = /^RX \d{4}( (XT|XTX|GRE))?$/i;
  return rtxPattern.test(name.toUpperCase()) || rxPattern.test(name.toUpperCase());
};

// ✅ 비주류 GPU 필터
const isUnwantedGPU = (name) =>
  /rtx\s*4500|radeon\s*pro|ada generation|titan|\bD$/i.test(name);

// ✅ GPU 벤치마크 크롤링
async function fetchGPUs() {
  const url = "https://www.topcpu.net/ko/gpu-r/3dmark-time-spy-desktop";
  const html = await axios.get(url).then(res => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];
  const nameSet = new Set();

  $("div.flex.flex-col").each((_, el) => {
    const name = $(el).find("a").first().text().trim();
    const scoreText = $(el).find("span.font-bold").first().text().replace(/,/g, "").trim();
    const score = parseInt(scoreText, 10);
    const simplified = simplifyForNaver(name);

    if (!name || isNaN(score)) return;
    if (score < 10000) return console.log("⛔ 제외 (점수 낮음):", name);
    if (!isValidGPUName(simplified)) return console.log("⛔ 제외 (형식 불일치):", name);
    if (isUnwantedGPU(name)) return console.log("⛔ 제외 (비주류):", name);

    const base = simplified.toLowerCase();
    if (nameSet.has(base)) return console.log("⛔ 제외 (중복):", name);
    nameSet.add(base);

    gpuList.push({ name, score });
  });

  console.log("✅ 크롤링 완료, 유효 GPU 수:", gpuList.length);
  return gpuList;
}

// ✅ 네이버 가격 + 이미지
async function fetchNaverPriceImage(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  const data = await res.json();

  for (const item of data.items || []) {
    const title = item.title.replace(/<[^>]*>/g, "");
    if (/리퍼|팬|방열|중고|쿨러|램|파워/i.test(title)) continue;
    const price = parseInt(item.lprice, 10);
    if (price < 150000 || price > 5000000) continue;
    return { price, image: item.image };
  }
  return null;
}

// ✅ GPT 요약
async function fetchGptSummary(name) {
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
          messages: [
            {
              role: "user",
              content: `${name} 그래픽카드의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'`,
            },
          ],
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
          messages: [
            {
              role: "user",
              content: `${name} 그래픽카드의 주요 사양을 요약해줘. VRAM, 클럭, 쿠다코어, 전력 위주로.`,
            },
          ],
        }),
      }),
    ]);

    const review = (await reviewRes.json()).choices?.[0]?.message?.content || "";
    const spec = (await specRes.json()).choices?.[0]?.message?.content || "";
    return { review, specSummary: spec };
  } catch (e) {
    console.log("❌ GPT 요약 실패:", name);
    return { review: "", specSummary: "" };
  }
}

// ✅ MongoDB 저장
async function saveToDB(gpus) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  const currentNames = new Set(gpus.map((g) => g.name));
  const existing = await col.find({ category: "gpu" }).toArray();

  for (const gpu of gpus) {
    const old = existing.find((e) => e.name === gpu.name);
    const priceEntry = { date: today, price: gpu.price };
    const update = {
      category: "gpu",
      price: gpu.price,
      image: gpu.image,
      review: gpu.review,
      specSummary: gpu.specSummary,
      benchmarkScore: { "3dmarkscore": gpu.score },
    };

    if (old) {
      const already = (old.priceHistory || []).some((p) => p.date === today);
      await col.updateOne(
        { _id: old._id },
        {
          $set: update,
          ...(already ? {} : { $push: { priceHistory: priceEntry } }),
        }
      );
      console.log("🔁 업데이트됨:", gpu.name);
    } else {
      await col.insertOne({
        name: gpu.name,
        ...update,
        priceHistory: [priceEntry],
      });
      console.log("🆕 삽입됨:", gpu.name);
    }
  }

  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "gpu", name: { $in: toDelete } });
    console.log("🗑️ 삭제됨:", toDelete.length, "개");
  }
}

// ✅ 실행 라우터
router.post("/sync-gpus", (req, res) => {
  res.json({ message: "✅ GPU 동기화 시작됨" });
  setImmediate(async () => {
    const raw = await fetchGPUs();
    const enriched = [];

    for (const gpu of raw) {
      const simplified = simplifyForNaver(gpu.name);
      const priceData = await fetchNaverPriceImage(simplified);
      if (!priceData) {
        console.log("⛔ 제외 (가격 문제):", gpu.name);
        continue;
      }
      const gpt = await fetchGptSummary(gpu.name);
      enriched.push({ ...gpu, ...priceData, ...gpt });
    }

    await saveToDB(enriched);
    console.log("🎉 모든 GPU 저장 완료");
  });
});

export default router;
