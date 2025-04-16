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

// ✅ 이름 정제 (강화 버전)
const cleanName = (raw) => {
  return raw
    .split("\n")[0]
    .replace(/\(.*?\)/g, "")         // 괄호 제거
    .replace(/®|™|CPU|Processor/gi, "") // 불필요한 단어 제거
    .replace(/-/g, " ")                // 하이픈을 공백으로
    .replace(/\s+/g, " ")             // 연속 공백 제거
    .trim();
};

// ✅ 크롤링
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

  // ✅ Cinebench 수집
  cine("table tbody tr").each((_, el) => {
    const tds = cine(el).find("td");
    const name = cleanName(tds.eq(0).text().trim());
    const single = parseInt(tds.eq(2).text().replace(/,/g, ""), 10);
    const multi = parseInt(tds.eq(3).text().replace(/,/g, ""), 10);
    if (!name || isNaN(single) || isNaN(multi)) return;
    cpus[name] = {
      cinebenchSingle: single,
      cinebenchMulti: multi,
    };
  });

  // ✅ PassMark 수집
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
    const isTooWeak = cinebenchSingle < 1000 && cinebenchMulti < 15000 && (!passmarkscore || passmarkscore < 10000);
    const isLaptopModel = /Ryzen.*(HX|HS|U|H|Z)|Core.*(HX|E|H)/i.test(name); // Ultra 예외 허용
    if (isTooWeak || isLaptopModel) {
      console.log("⛔️ 필터 제외:", name);
      continue;
    }
    cpuList.push({
      name,
      cinebenchSingle,
      cinebenchMulti,
      passmarkscore: passmarkscore ?? null,
    });
  }

  console.log("✅ 필터링된 CPU 수:", cpuList.length);
  return cpuList;
}

// ✅ 나머지 로직 동일
// ... 이하 생략 (가격, GPT, 저장, router.post 등 유지)
