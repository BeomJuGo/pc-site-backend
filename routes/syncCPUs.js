// routes/syncCPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
// Naver API credentials
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 이름 정제 (강화 버전)
const cleanName = (raw) => {
  return raw
    .split("\n")[0]
    .replace(/\(.*?\)/g, "")
    .replace(/®|™|CPU|Processor/gi, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// ✅ 네이버 가격 (중간값 기준)
async function fetchNaverPrice(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encoded}`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
@@ -50,51 +51,51 @@ async function fetchCPUsFromTechMons() {
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
    cpus[name] = {
      cinebenchSingle: single,
      cinebenchMulti: multi,
    };
  });

  pass("table tbody tr").each((_, el) => {
    const tds = pass(el).find("td");
    const name = cleanName(tds.eq(0).text().trim()); // CPU model name
    const score = parseInt(tds.eq(1).text().replace(/,/g, ""), 10);
    if (!name || isNaN(score)) return;
    if (!cpus[name]) cpus[name] = {};
    cpus[name].passmarkscore = score;
  });

  const cpuList = [];
  for (const [name, scores] of Object.entries(cpus)) {
    const { cinebenchSingle = 0, cinebenchMulti = 0, passmarkscore = undefined } = scores;
    const isTooWeak = cinebenchSingle < 1000 && cinebenchMulti < 15000 && (!passmarkscore || passmarkscore < 10000);
    const isLaptopModel = /Apple\s*M\d|Ryzen.*(HX|HS|U|H|Z)|Core.*(HX|E|H)/i.test(name);

    const priceObj = await fetchNaverPrice(name);
    if (!priceObj || priceObj.price < 10000 || priceObj.price > 2000000) {
      console.log("⛔ 제외 (가격 없음/이상치):", name);
      continue;
    }

    const valueScore = (passmarkscore || 0) / priceObj.price;
    const isLowValue = valueScore < 0.015;
    if (isTooWeak || isLaptopModel || isLowValue) {
      console.log("⛔ 필터 제외:", name, `(가성비 ${valueScore.toFixed(4)})`);
      continue;
    }
