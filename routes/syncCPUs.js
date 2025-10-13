// routes/syncCPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// CPU 이름 정제
const cleanName = (raw) => {
  return raw
    .split("\n")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/®|™|CPU|Processor/gi, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// CPU 성능 크롤링 (tech-mons)
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

  // Cinebench 점수 수집
  cine("table tbody tr").each((_, el) => {
    const tds = cine(el).find("td");
    const name = cleanName(tds.eq(0).text().trim());
    const single = parseInt(tds.eq(2).text().replace(/,/g, ""), 10);
    const multi = parseInt(tds.eq(3).text().replace(/,/g, ""), 10);
    if (!name || isNaN(single) || isNaN(multi)) return;
    cpus[name] = { cinebenchSingle: single, cinebenchMulti: multi };
  });

  // PassMark 점수 수집
  pass("table tbody tr").each((_, el) => {
    const tds = pass(el).find("td");
    const name = cleanName(tds.eq(0).text().trim());
    const score = parseInt(tds.eq(1).text().replace(/,/g, ""), 10);
    if (!name || isNaN(score)) return;
    if (!cpus[name]) cpus[name] = {};
    cpus[name].passmarkscore = score;
  });

  // 낮은 성능·랩탑용 모델 제외 (가격 필터 없이)
  const cpuList = [];
  for (const [name, scores] of Object.entries(cpus)) {
    const {
      cinebenchSingle = 0,
      cinebenchMulti = 0,
      passmarkscore = undefined,
    } = scores;

    const isTooWeak =
      cinebenchSingle < 1000 &&
      cinebenchMulti < 15000 &&
      (!passmarkscore || passmarkscore < 10000);
    const isLaptopModel = /Apple\s*M\d|Ryzen.*(HX|HS|U|H|Z)|Core.*(HX|E|H)/i.test(
      name
    );
    if (isTooWeak || isLaptopModel) continue;

    cpuList.push({
      name,
      passmarkscore,
      cinebenchSingle,
      cinebenchMulti,
    });
  }

  console.log("✅ 크롤링 완료, 유효 CPU 수:", cpuList.length);
  return cpuList;
}

// GPT 요약: 장점/단점 + 사양 요약
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
          model: "gpt-4",
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
          model: "gpt-4",
          messages: [
            {
              role: "user",
              content: `${name} CPU의 주요 사양을 요약해줘. 코어/스레드, 캐시, 베이스/부스트 클럭 위주로.`,
            },
          ],
        }),
      }),
    ]);

    const review =
      (await reviewRes.json()).choices?.[0]?.message?.content || "";
    const spec = (await specRes.json()).choices?.[0]?.message?.content || "";
    return { review, specSummary: spec };
  } catch (e) {
    console.log("❌ GPT 요약 실패:", name);
    return { review: "", specSummary: "" };
  }
}

// MongoDB 저장: 가격·이미지는 다루지 않음
async function saveCPUsToMongo(cpus) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cpu" }).toArray();
  const currentNames = new Set(cpus.map((c) => c.name));

  for (const cpu of cpus) {
    const old = existing.find((e) => e.name === cpu.name);
    const update = {
      category: "cpu",
      review: cpu.review,
      specSummary: cpu.specSummary,
      benchmarkScore: {
        passmarkscore: cpu.passmarkscore,
        cinebenchSingle: cpu.cinebenchSingle,
        cinebenchMulti: cpu.cinebenchMulti,
      },
    };

    if (old) {
      // 기존 문서는 price/priceHistory를 유지하며 성능·요약만 갱신
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log("🔁 업데이트됨:", cpu.name);
    } else {
      // 새 문서는 priceHistory를 빈 배열로 초기화
      await col.insertOne({
        name: cpu.name,
        ...update,
        priceHistory: [],
      });
      console.log("🆕 삽입됨:", cpu.name);
    }
  }

  // 목록에 없어진 CPU는 삭제
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cpu", name: { $in: toDelete } });
    console.log("🗑️ 삭제됨:", toDelete.length, "개");
  }
}

// 실행 라우터
router.post("/sync-cpus", (req, res) => {
  res.json({ message: "✅ CPU 동기화 시작됨 (가격 미포함)" });
  setImmediate(async () => {
    const rawList = await fetchCPUsFromTechMons();
    const enriched = [];

    for (const cpu of rawList) {
      const gpt = await fetchGptSummary(cpu.name);
      enriched.push({ ...cpu, ...gpt });
    }

    await saveCPUsToMongo(enriched);
    console.log("🎉 모든 CPU 정보 저장 완료");
  });
});

export default router;
