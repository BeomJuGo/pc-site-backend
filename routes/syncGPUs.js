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

const cleanName = (raw) =>
  raw
    .split("\n")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/\b(GPU|Graphics|GEFORCE|RADEON|RTX|RX|PRO|\d{4,})\b/gi, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

async function fetchGPUsFromTopCPU() {
  const url = "https://www.topcpu.net/ko/gpu-r/3dmark-time-spy-desktop";
  const html = await axios.get(url).then((res) => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];

  $("table tbody tr").each((_, el) => {
    const cols = $(el).find("td");
    const name = $(cols[1]).text().trim();
    const score = parseInt($(cols[2]).text().replace(/,/g, ""), 10);
    if (!name || isNaN(score)) return;

    if (score < 10000) return;
    if (/rtx 4500|radeon pro w7700/i.test(name)) return;

    gpuList.push({ name, score });
  });

  return gpuList;
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
  return item ? { price: parseInt(item.lprice, 10), image: item.image || "" } : null;
}

async function fetchGptSummary(name) {
  const [reviewPrompt, specPrompt] = [
    `${name} 그래픽카드의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`,
    `${name} 그래픽카드의 주요 사양을 요약해줘. VRAM, 클럭, 쿠다코어, 전력 위주로.`,
  ];
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
    return { review: "", specSummary: "" };
  }
}

async function saveGPUsToMongo(gpus) {
  const db = getDB();
  const collection = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  const inserted = new Set();

  for (const gpu of gpus) {
    const norm = cleanName(gpu.name);
    if (inserted.has(norm)) {
      console.log("⚠️ 중복 제외:", gpu.name);
      continue;
    }
    inserted.add(norm);

    const priceData = await fetchNaverPrice(gpu.name);
    if (!priceData || priceData.price < 10000 || priceData.price > 3000000) {
      console.log("⛔ 가격 제외:", gpu.name);
      continue;
    }

    const gpt = await fetchGptSummary(gpu.name);
    const existing = await collection.findOne({ name: gpu.name });

    const updateFields = {
      category: "gpu",
      price: priceData.price,
      image: priceData.image,
      review: gpt.review,
      specSummary: gpt.specSummary,
      benchmarkScore: { timeSpy: gpu.score },
    };

    const priceEntry = { date: today, price: priceData.price };

    if (existing) {
      const alreadyLogged = (existing.priceHistory || []).some((h) => h.date === today);
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: updateFields,
          ...(alreadyLogged ? {} : { $push: { priceHistory: priceEntry } }),
        }
      );
    } else {
      await collection.insertOne({
        name: gpu.name,
        ...updateFields,
        priceHistory: [priceEntry],
      });
    }
  }
}

router.post("/sync-gpus", async (req, res) => {
  res.json({ message: "✅ GPU 동기화 시작됨" });
  const list = await fetchGPUsFromTopCPU();
  await saveGPUsToMongo(list);
  console.log("✅ GPU 저장 완료");
});

export default router;
