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

// ✅ Cinebench 및 PassMark 크롤링
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

  // ✅ Cinebench 점수 수집
  cine("table tbody tr").each((_, el) => {
    const name = cine(el).find("td").eq(0).text().trim();
    const single = parseInt(cine(el).find("td").eq(1).text().replace(/,/g, ""), 10);
    const multi = parseInt(cine(el).find("td").eq(2).text().replace(/,/g, ""), 10);

    if (!name || isNaN(single) || isNaN(multi)) return;
    if (!cpus[name]) cpus[name] = {};
    cpus[name].cinebenchSingle = single;
    cpus[name].cinebenchMulti = multi;
  });

  // ✅ PassMark 점수 수집
  pass("table tbody tr").each((_, el) => {
    const name = pass(el).find("td").eq(0).text().trim();
    const score = parseInt(pass(el).find("td").eq(1).text().replace(/,/g, ""), 10);

    if (!name || isNaN(score)) return;
    if (!cpus[name]) cpus[name] = {};
    cpus[name].passmarkscore = score;
  });

  const cpuList = [];
  for (const [name, scores] of Object.entries(cpus)) {
    const { cinebenchSingle = 0, cinebenchMulti = 0, passmarkscore = 0 } = scores;

    const isTooWeak = cinebenchSingle < 1000 && cinebenchMulti < 15000 && passmarkscore < 10000;
    const isLaptopModel = /Ryzen.*(HX|HS|U|H|Z)|Core.*(HX|U|E|H)/i.test(name);
    if (isTooWeak || isLaptopModel) continue;

    cpuList.push({
      name: cleanName(name),
      cinebenchSingle,
      cinebenchMulti,
      passmarkscore,
    });
  }

  console.log(`✅ 필터링된 CPU 수: ${cpuList.length}`);
  return cpuList;
}

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
  const item = data.items?.[0];
  return item
    ? {
        price: parseInt(item.lprice, 10),
        image: item.image || "",
      }
    : null;
}

// ✅ GPT 한줄평 + 사양 요약
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

  // 기존 CPU 모두 제거
  await collection.deleteMany({ category: "cpu" });

  for (const cpu of cpus) {
    try {
      await collection.insertOne({
        category: "cpu",
        name: cpu.name,
        benchmarkScore: {
          passmarkscore: cpu.passmarkscore,
          cinebenchSingle: cpu.cinebenchSingle,
          cinebenchMulti: cpu.cinebenchMulti,
        },
        priceHistory: [{ date: today, price: cpu.price || 0 }],
        review: cpu.review || "",
        specSummary: cpu.specSummary || "",
        image: cpu.image || "",
      });

      console.log("✅ 저장 완료:", cpu.name);
    } catch (err) {
      console.error("❌ 저장 오류:", err);
    }
  }
}

// ✅ API 엔드포인트
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 동기화 시작됨 (백그라운드에서 처리 중)" });

  setImmediate(async () => {
    try {
      const rawList = await fetchCPUsFromTechMons();
      const enriched = [];

      for (const cpu of rawList) {
        const priceObj = await fetchNaverPrice(cpu.name);
        if (!priceObj || priceObj.price < 10000 || priceObj.price > 2000000) continue;

        const gpt = await fetchGptSummary(cpu.name);
        enriched.push({ ...cpu, ...priceObj, ...gpt });
      }

      await saveCPUsToMongo(enriched);
    } catch (err) {
      console.error("❌ 전체 동기화 실패:", err);
    }
  });
});

export default router;
