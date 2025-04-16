// ✅ routes/syncCPUs.js (최신 버전 - 이름 정규화, PassMark 보정, 로그 포함)
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const normalizeName = (name) => name.split("\n")[0].split("(")[0].trim();

// ✅ Cinebench + PassMark 크롤링
async function fetchCPUsFromTechMons() {
  const cineUrl = "https://tech-mons.com/desktop-cpu-cinebench/";
  const passUrl = "https://tech-mons.com/desktop-cpu-benchmark-ranking/";
  const [cineHtml, passHtml] = await Promise.all([
    axios.get(cineUrl).then((res) => res.data),
    axios.get(passUrl).then((res) => res.data),
  ]);
  const cine = cheerio.load(cineHtml);
  const pass = cheerio.load(passHtml);

  const cpus = {};

  // ✅ Cinebench 기준으로 수집
  cine("table tbody tr").each((_, el) => {
    const tds = cine(el).find("td");
    const rawName = tds.eq(0).text().trim();
    const name = normalizeName(rawName);
    const single = parseInt(tds.eq(2).text().replace(/,/g, ""), 10);
    const multi = parseInt(tds.eq(3).text().replace(/,/g, ""), 10);
    if (!name || isNaN(single) || isNaN(multi)) return;
    cpus[name] = { name, cinebenchSingle: single, cinebenchMulti: multi, passmarkscore: undefined };
  });

  // ✅ PassMark 점수 보정 (이름 포함 매칭)
  pass("table tbody tr").each((_, el) => {
    const rawName = pass(el).find("td").eq(0).text().trim();
    const passScore = parseInt(pass(el).find("td").eq(1).text().replace(/,/g, ""), 10);
    const passName = normalizeName(rawName);
    if (!passName || isNaN(passScore)) return;

    for (const key of Object.keys(cpus)) {
      if (
        key.toLowerCase().includes(passName.toLowerCase()) ||
        passName.toLowerCase().includes(key.toLowerCase())
      ) {
        cpus[key].passmarkscore = passScore;
      }
    }
  });

  const cpuList = [];
  for (const cpu of Object.values(cpus)) {
    const { name, cinebenchSingle = 0, cinebenchMulti = 0, passmarkscore } = cpu;
    const isTooWeak = cinebenchSingle < 1000 && cinebenchMulti < 15000 && (passmarkscore || 0) < 10000;
    const isLaptop = /Ryzen.*(HX|HS|U|H|Z)|Core.*(HX|E|H)/i.test(name);
    if (isTooWeak || isLaptop) {
      console.log("⛔️ 필터 제외:", name);
      continue;
    }
    cpuList.push(cpu);
  }
  console.log("✅ 필터링된 CPU 수:", cpuList.length);
  return cpuList;
}

// ✅ 네이버 가격 및 이미지
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

// ✅ GPT 정보 요약
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
        body: JSON.stringify({ model: "gpt-3.5-turbo", messages: [{ role: "user", content: reviewPrompt }], max_tokens: 200 }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
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
    console.error("❌ GPT 오류:", e.message);
    return { review: "", specSummary: "" };
  }
}

// ✅ MongoDB 저장
async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const collection = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  const { deletedCount } = await collection.deleteMany({ category: "cpu" });
  console.log(`🧹 기존 ${deletedCount}개 삭제됨`);

  for (const cpu of cpus) {
    try {
      await collection.insertOne({
        category: "cpu",
        name: cpu.name,
        price: cpu.price,
        benchmarkScore: {
          passmarkscore: cpu.passmarkscore ?? null,
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
      console.error("❌ 저장 오류:", cpu.name, err.message);
    }
  }
}

// ✅ 엔드포인트
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 동기화 시작됨 (백그라운드에서 처리 중)" });
  setImmediate(async () => {
    try {
      const rawList = await fetchCPUsFromTechMons();
      const enriched = [];
      for (const cpu of rawList) {
        const priceObj = await fetchNaverPrice(cpu.name);
        if (!priceObj || priceObj.price < 10000 || priceObj.price > 2000000) {
          console.log("⛔️ 제외 (가격 비정상):", cpu.name);
          continue;
        }
        const gpt = await fetchGptSummary(cpu.name);
        enriched.push({ ...cpu, ...priceObj, ...gpt });
      }
      await saveCPUsToMongo(enriched);
      console.log("🎉 모든 CPU 저장 완료");
    } catch (err) {
      console.error("❌ 전체 동기화 실패:", err.message);
    }
  });
});

export default router;
