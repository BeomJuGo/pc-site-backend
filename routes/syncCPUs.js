// ✅ routes/0sync-cpus.js
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
const cleanName = (raw) => {
  return raw
    .split("\n")[0]
    .replace(/®|™|CPU|Processor/gi, "")
    .replace(/-/g, " ")
    .replace(/Intel Core Ultra|Intel Core|AMD Ryzen|AMD/gi, "")
    .replace(/\s+/g, " ")
    .trim();
};

// ✅ CPU 이름 필터링
const isAllowedCPU = (name) => {
  const intelRegex = /^(i\d\s*\d{4,5}[fFkK]?|\d{3,5}[kKfF]?)$/i;
  const amdRegex = /^(\d{4}[xX3dD]?|\d{4}[gG]?|pro\s*\d{4}(g[eE]?)?)$/i;
  return intelRegex.test(name) || amdRegex.test(name.toLowerCase());
};

// ✅ 중간값 가격 계산 알고리즘
const getMedianPrice = (items) => {
  const validPrices = items
    .filter(
      (item) =>
        item &&
        item.title &&
        !/중고|리퍼|쿨러|노트북|세트|램/i.test(item.title)
    )
    .map((item) => parseInt(item.lprice, 10))
    .filter((p) => p >= 50000 && p <= 2000000)
    .sort((a, b) => a - b);

  if (validPrices.length === 0) return null;
  const mid = Math.floor(validPrices.length / 2);
  return validPrices.length % 2 === 0
    ? Math.floor((validPrices[mid - 1] + validPrices[mid]) / 2)
    : validPrices[mid];
};

// ✅ 네이버 가격 + 이미지
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
  if (!data.items) return null;
  const median = getMedianPrice(data.items);
  const image = data.items.find((item) => parseInt(item.lprice) === median)?.image || "";
  return median ? { price: median, image } : null;
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
              content: `${name}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'`,
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
              content: `${name}의 주요 사양을 요약해줘. 코어 수, 스레드 수, 클럭 위주로.`,
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

// ✅ MongoDB 저장
async function saveToMongo(cpus) {
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
      benchmarkScore: {
        passmarkscore: cpu.passmarkscore,
        cinebenchSingle: cpu.cinebenchSingle,
        cinebenchMulti: cpu.cinebenchMulti,
      },
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
      console.log("🔁 업데이트됨:", cpu.name);
    } else {
      await col.insertOne({
        name: cpu.name,
        ...update,
        priceHistory: [priceEntry],
      });
      console.log("🆕 삽입됨:", cpu.name);
    }
  }

  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cpu", name: { $in: toDelete } });
    console.log("🗑️ 삭제됨:", toDelete.length, "개");
  }
}

// ✅ 실행
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 동기화 시작됨" });
  setImmediate(async () => {
    const url1 = "https://tech-mons.com/desktop-cpu-cinebench/";
    const url2 = "https://tech-mons.com/desktop-cpu-benchmark-ranking/";
    const [html1, html2] = await Promise.all([
      axios.get(url1).then((r) => r.data),
      axios.get(url2).then((r) => r.data),
    ]);
    const $1 = cheerio.load(html1);
    const $2 = cheerio.load(html2);
    const map = new Map();

    $1("table tbody tr").each((_, el) => {
      const td = $1(el).find("td");
      const name = cleanName(td.eq(0).text());
      const cbs = parseInt(td.eq(2).text().replace(/,/g, ""), 10);
      const cbm = parseInt(td.eq(3).text().replace(/,/g, ""), 10);
      if (!isAllowedCPU(name)) return;
      map.set(name, { name, cinebenchSingle: cbs, cinebenchMulti: cbm });
    });

    $2("table tbody tr").each((_, el) => {
      const td = $2(el).find("td");
      const name = cleanName(td.eq(0).text());
      const score = parseInt(td.eq(1).text().replace(/,/g, ""), 10);
      if (!map.has(name)) return;
      map.get(name).passmarkscore = score;
    });

    const enriched = [];
    for (const cpu of map.values()) {
      const priceData = await fetchNaverPrice(cpu.name);
      if (!priceData) continue;
      const gpt = await fetchGptSummary(cpu.name);
      enriched.push({ ...cpu, ...priceData, ...gpt });
    }

    await saveToMongo(enriched);
    console.log("🎉 모든 CPU 저장 완료");
  });
});

export default router;
