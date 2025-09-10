// routes/syncCPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
the const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// CPU 이름 정제
const cleanName = (raw) =>
  raw
    .split("\n")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/®|™|CPU|Processor/gi, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 네이버 가격(중앙값)
async function fetchNaverPrice(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  const data = await res.json();
  const items = (data.items || []).filter(
    (item) => !/중고|리퍼|쿨러|노트북|세트/i.test(item.title)
  );
  if (items.length === 0) return null;
  const prices = items
    .map((item) => parseInt(item.lprice, 10))
    .filter((p) => !isNaN(p) && p >= 10000 && p <= 2000000)
    .sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0 ? Math.round((prices[mid - 1] + prices[mid]) / 2) : prices[mid];
  return { price: median, image: items[0].image || "" };
}

// Tech-Mons 크롤링
async function fetchCPUsFromTechMons() {
  const cinebenchUrl = "https://tech-mons.com/desktop-cpu-cinebench/";
  const passmarkUrl = "https://tech-mons.com/desktop-cpu-benchmark-ranking/";
  const [cineHtml, passHtml] = await Promise.all([
    axios.get(cinebenchUrl).then((res) => res.data),
    axios.get(passmarkUrl).then((res) => res.data),
  ]);
  const cine = cheerio.load(cineHtml);
  const pass = cheerio.load(passHtml);
  const cpus = {};

  cine("table tbody tr").each((_, el) => {
    const tds = cine(el).find("td");
    const name = cleanName(tds.eq(0).text().trim());
    const single = parseInt(tds.eq(2).text().replace(/,/g, ""), 10);
    const multi = parseInt(tds.eq(3).text().replace(/,/g, ""), 10);
    if (!name || isNaN(single) || isNaN(multi)) return;
    cpus[name] = { cinebenchSingle: single, cinebenchMulti: multi };
  });

  pass("table tbody tr").each((_, el) => {
    const tds = pass(el).find("td");
    const name = cleanName(tds.eq(0).text().trim());
    const score = parseInt(tds.eq(1).text().replace(/,/g, ""), 10);
    if (!name || isNaN(score)) return;
    if (!cpus[name]) cpus[name] = {};
    cpus[name].passmarkscore = score;
  });

  const cpuList = [];
  for (const [name, scores] of Object.entries(cpus)) {
    const { cinebenchSingle = 0, cinebenchMulti = 0, passmarkscore = undefined } = scores;
    const isTooWeak =
      cinebenchSingle < 1000 &&
      cinebenchMulti < 15000 &&
      (!passmarkscore || passmarkscore < 10000);
    const isLaptopModel = /Apple\s*M\d|Ryzen.*(HX|HS|U|H|Z)|Core.*(HX|E|H)/i.test(name);

    const priceObj = await fetchNaverPrice(name);
    if (!priceObj || priceObj.price < 10000 || priceObj.price > 2000000) continue;

    const valueScore = (passmarkscore || 0) / priceObj.price;
    const isLowValue = valueScore < 0.015;
    if (isTooWeak || isLaptopModel || isLowValue) continue;

    cpuList.push({
      name,
      cinebenchSingle,
      cinebenchMulti,
      passmarkscore: passmarkscore ?? null,
      price: priceObj.price,
      image: priceObj.image,
    });
  }
  return cpuList;
}

// GPT 요청: 칩셋 + 리뷰/사양
async function fetchGptInfo(name) {
  const chipsetPrompt = `${name}와 호환 가능한 데스크탑 메인보드 칩셋을 JSON 배열로만 알려줘.`;
  const reviewPrompt = `${name}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;
  const specPrompt = `${name}의 주요 사양을 요약해서 알려줘.`;

  const req = (prompt) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
      }),
    }).then((r) => r.json());

  try {
    const [chipsetRes, reviewRes, specRes] = await Promise.all([
      req(chipsetPrompt),
      req(reviewPrompt),
      req(specPrompt),
    ]);
    const chipsetsRaw = chipsetRes.choices?.[0]?.message?.content || "[]";
    return {
      supportedChipsets: JSON.parse(chipsetsRaw),
      review: reviewRes.choices?.[0]?.message?.content || "",
      specSummary: specRes.choices?.[0]?.message?.content || "",
    };
  } catch (e) {
    return { supportedChipsets: [], review: "", specSummary: "" };
  }
}

// MongoDB 저장
async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const collection = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  for (const cpu of cpus) {
    const existing = await collection.findOne({ name: cpu.name });
    const updateFields = {
      category: "cpu",
      price: cpu.price,
      benchmarkScore: {
        passmarkscore: cpu.passmarkscore,
        cinebenchSingle: cpu.cinebenchSingle,
        cinebenchMulti: cpu.cinebenchMulti,
      },
      supportedChipsets: cpu.supportedChipsets,
      review: cpu.review,
      specSummary: cpu.specSummary,
      image: cpu.image,
    };
    const priceEntry = { date: today, price: cpu.price || 0 };

    if (existing) {
      const already = (existing.priceHistory || []).some((h) => String(h.date) === today);
      await collection.updateOne(
        { _id: existing._id },
        { $set: updateFields, ...(already ? {} : { $push: { priceHistory: priceEntry } }) }
      );
    } else {
      await collection.insertOne({
        name: cpu.name,
        ...updateFields,
        priceHistory: [priceEntry],
      });
    }
  }
}

// 실행 라우터
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 동기화 시작됨 (백그라운드)" });
  setImmediate(async () => {
    const rawList = await fetchCPUsFromTechMons();
    const enriched = [];
    for (const cpu of rawList) {
      const gpt = await fetchGptInfo(cpu.name);
      enriched.push({ ...cpu, ...gpt });
    }
    await saveCPUsToMongo(enriched);
    console.log("🎉 모든 CPU 저장 완료");
  });
});

export default router;
