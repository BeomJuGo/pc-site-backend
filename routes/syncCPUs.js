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

const simplifyCPUName = (name) => {
  if (/Intel/i.test(name)) {
    return name
      .replace(/Intel\s+(Core|Pentium|Celeron|Atom|Xeon)?\s*(Ultra)?\s*/i, "")
      .replace(/Processor|CPU/gi, "")
      .replace(/[^0-9a-zA-Z ]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
  } else if (/AMD/i.test(name)) {
    return name
      .replace(/AMD\s+Ryzen\s*/i, "")
      .replace(/Processor|CPU/gi, "")
      .replace(/[^0-9a-zA-Z ]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
  }
  return name.toLowerCase().trim();
};

const isValidCPUName = (name) => {
  const intelRegex = /^(i\d\s?\d{4,5}(f|k|kf)?)$/i;
  const amdRegex = /^(\d{4}(x|g|x3d)?|^\d{3,4})$/i;
  return intelRegex.test(name) || amdRegex.test(name);
};


const isUnwantedCPU = (name) =>
  /ES|OEM|Engineering|Sample/i.test(name);

async function fetchCPUs() {
  const url = "https://www.tech-mons.com/desktop-cpu-cinebench/";
  const html = await axios.get(url).then((res) => res.data);
  const $ = cheerio.load(html);
  const list = [];
  const nameSet = new Set();

  $("table tbody tr").each((_, el) => {
    const tds = $(el).find("td");
    const name = $(tds[1]).text().trim();
    const scoreText = $(tds[2]).text().replace(/,/g, "").trim();
    const score = parseInt(scoreText, 10);
    const simplified = simplifyCPUName(name);

    if (!name || isNaN(score)) return;
    if (score < 2000) return;
    if (!isValidCPUName(simplified)) return;
    if (isUnwantedCPU(name)) return;
    if (nameSet.has(simplified)) return;

    nameSet.add(simplified);
    list.push({ name, score });
  });

  console.log("✅ CPU 크롤링 완료:", list.length);
  return list;
}

async function fetchNaverPriceImage(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  const data = await res.json();

  for (const item of data.items || []) {
    const title = item.title.toLowerCase();
    if (/(리퍼|중고|쿨러|램|파워|노트북)/.test(title)) continue;
    const price = parseInt(item.lprice, 10);
    if (price < 100000 || price > 2000000) continue;
    return { price, image: item.image };
  }
  return null;
}

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
              content: `${name} CPU의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'`,
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
              content: `${name} CPU의 주요 사양을 요약해줘. 코어 수, 스레드 수, 클럭, 캐시 위주로.`,
            },
          ],
        }),
      }),
    ]);

    const review = (await reviewRes.json()).choices?.[0]?.message?.content || "";
    const spec = (await specRes.json()).choices?.[0]?.message?.content || "";
    return { review, specSummary: spec };
  } catch {
    return { review: "", specSummary: "" };
  }
}

async function saveToDB(cpus) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  const currentNames = new Set(cpus.map((c) => c.name));
  const existing = await col.find({ category: "cpu" }).toArray();

  for (const cpu of cpus) {
    const old = existing.find((e) => e.name === cpu.name);
    const priceEntry = { date: today, price: cpu.price };
    const update = {
      category: "cpu",
      price: cpu.price,
      image: cpu.image,
      review: cpu.review,
      specSummary: cpu.specSummary,
      benchmarkScore: { cinebenchMulti: cpu.score },
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
    } else {
      await col.insertOne({ name: cpu.name, ...update, priceHistory: [priceEntry] });
    }
  }

  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length) {
    await col.deleteMany({ category: "cpu", name: { $in: toDelete } });
  }
}

router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 동기화 시작됨" });
  setImmediate(async () => {
    const raw = await fetchCPUs();
    const enriched = [];

    for (const cpu of raw) {
      const simplified = simplifyCPUName(cpu.name);
      const priceData = await fetchNaverPriceImage(simplified.toUpperCase());
      if (!priceData) continue;
      const gpt = await fetchGptSummary(cpu.name);
      enriched.push({ ...cpu, ...priceData, ...gpt });
    }

    await saveToDB(enriched);
    console.log("🎉 모든 CPU 저장 완료");
  });
});

export default router;
