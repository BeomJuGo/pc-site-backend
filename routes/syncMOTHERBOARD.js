// routes/syncMOTHERBOARD.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const router = express.Router();

const ORIGIN = "https://versus.com";
const LIST_URL = (p) => `${ORIGIN}/en/motherboard?page=${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, tryCount = 0) {
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
        Referer: ORIGIN,
      },
    });
    return res.data;
  } catch (e) {
    if (tryCount < 2) {
      console.log(`⚠️ 재시도(${tryCount + 1}) → ${url}`);
      await sleep(1200);
      return fetchHtml(url, tryCount + 1);
    }
    console.log(`❌ 요청 실패: ${url} (${e?.response?.status || e.message})`);
    return null;
  }
}

/** /en/<slug> 한 단계만 허용 (= 제품 후보), /en/motherboard/* 등은 제외 */
function isOneLevelProductHref(href) {
  if (!href?.startsWith("/en/")) return false;
  if (href.startsWith("/en/motherboard/")) return false; // 허브/가이드 제외
  // '/en/slug' 만 허용 (추가 세그먼트, 쿼리 제거)
  const path = href.split("?")[0];
  const parts = path.split("/").filter(Boolean); // ["en","slug"]
  return parts.length === 2; // 정확히 /en/<slug>
}

/** 리스트 페이지에서 후보 수집 */
function extractProductCandidates($) {
  const candidates = new Set();
  $('a[href^="/en/"]').each((_, a) => {
    const href = $(a).attr("href");
    if (!isOneLevelProductHref(href)) return;
    const abs = href.startsWith("http") ? href : `${ORIGIN}${href.split("?")[0]}`;
    candidates.add(abs);
  });
  return Array.from(candidates);
}

/** 상세에서 제품명 */
function extractProductName($) {
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;
  const og = $('meta[property="og:title"]').attr("content");
  if (og) return og.trim();
  const title = $("title").text().trim();
  return title || "";
}

/** 상세에서 칩셋/소켓 → "Chipset: XXX" */
function extractChipsetInfo($) {
  // 0) 전체 텍스트
  const full = $("body").text().replace(/\s+/g, " ").trim();

  // 1) 표
  let info = null;
  $("table tr").each((_, tr) => {
    const left = $(tr).find("th,td").first().text().trim().toLowerCase();
    const right = $(tr).find("td,th").eq(1).text().trim();
    if (!right) return;
    if (/chipset/i.test(left)) info = `Chipset: ${right}`;
    else if (/(cpu\s*socket|socket)/i.test(left)) info = `Chipset: ${right}`;
  });
  if (info) return info;

  // 2) 라벨/정의/카드형
  $('li, div, section, p, span, dt, dd').each((_, el) => {
    const txt = $(el).text().trim();
    if (!txt) return;
    const m1 = txt.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
    if (m1?.[1]) { info = `Chipset: ${m1[1].trim()}`; return false; }
    const m2 = txt.match(/(cpu\s*socket|socket)\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
    if (m2?.[2]) { info = `Chipset: ${m2[2].trim()}`; return false; }
  });
  if (info) return info;

  // 3) JSON-LD
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const t = $(s).contents().text();
      const j = JSON.parse(t);
      const texts = [];
      if (Array.isArray(j)) j.forEach(x => texts.push(x?.name, x?.description));
      else texts.push(j?.name, j?.description);
      const str = texts.filter(Boolean).join(" ");
      const m1 = str.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
      if (m1?.[1]) { info = `Chipset: ${m1[1].trim()}`; return false; }
      const m2 = str.match(/(cpu\s*socket|socket)\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
      if (m2?.[2]) { info = `Chipset: ${m2[2].trim()}`; return false; }
    } catch {}
  });
  if (info) return info;

  // 4) 최후: 전체 텍스트 정규식
  const m1 = full.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]{2,20})/i);
  if (m1?.[1]) return `Chipset: ${m1[1].trim()}`;
  const m2 = full.match(/(cpu\s*socket|socket)\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]{2,20})/i);
  if (m2?.[2]) return `Chipset: ${m2[2].trim()}`;

  return "";
}

/** 상세가 ‘메인보드’ 맞는지 최소 검증 */
function isLikelyMotherboardPage($) {
  const body = $("body").text().toLowerCase();
  // ‘motherboard’ 키워드 + ‘chipset/socket’ 중 하나라도 있으면 긍정
  const hasMotherboard = body.includes("motherboard");
  const hasSpecHint = body.includes("chipset") || body.includes("socket");
  return hasMotherboard && hasSpecHint;
}

async function collectCandidates(pages = 2) {
  const out = new Set();
  for (let p = 1; p <= pages; p++) {
    const url = LIST_URL(p);
    console.log(`🔎 리스트 페이지: ${url}`);
    const html = await fetchHtml(url);
    if (!html) { console.log("⛔ 리스트 HTML 없음"); continue; }
    const $ = cheerio.load(html);
    const found = extractProductCandidates($);
    console.log(`📃 후보 수집: ${found.length}건`);
    found.forEach(u => out.add(u));
    await sleep(600);
  }
  console.log(`✅ 중복제거 후 후보 합계: ${out.size}건`);
  return Array.from(out);
}

async function fetchDetail(u) {
  const html = await fetchHtml(u);
  if (!html) return null;
  const $ = cheerio.load(html);
  const name = extractProductName($);
  if (!name) { console.log(`⛔ 이름 미발견: ${u}`); return null; }

  const info = extractChipsetInfo($);
  const ok = isLikelyMotherboardPage($);

  if (!ok) console.log(`⚠️ 메인보드 페이지로 확신 부족 (키워드 부족): ${u}`);
  if (!info) console.log(`⚠️ 칩셋/소켓 미발견: ${u}`);

  return { name, info };
}

async function saveToDB(list) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "motherboard" }).toArray();
  const byName = new Map(existing.map(x => [x.name, x]));

  for (const it of list) {
    const old = byName.get(it.name);
    const update = { category: "motherboard", info: it.info || "" };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log(`🔁 업데이트: ${it.name} | ${it.info || "—"}`);
    } else {
      await col.insertOne({ name: it.name, ...update, priceHistory: [] });
      console.log(`🆕 삽입: ${it.name} | ${it.info || "—"}`);
    }
    await sleep(200);
  }
}

router.post("/sync-motherboards", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 2;
    const hardLimit = Number(req?.body?.limit) || 50;

    res.json({ message: `✅ 메인보드 동기화 시작 (pages=${pages}, limit=${hardLimit})` });

    setImmediate(async () => {
      const cand = await collectCandidates(pages);
      const picked = [];
      for (const u of cand.slice(0, hardLimit)) {
        console.log(`🔬 상세 파싱: ${u}`);
        const info = await fetchDetail(u);
        if (!info) continue;
        picked.push(info);
        await sleep(400);
      }
      if (picked.length === 0) {
        console.log("⛔ 저장할 항목 없음 (후보 0)");
        return;
      }
      await saveToDB(picked);
      console.log("🎉 메인보드 저장 완료");
    });
  } catch (err) {
    console.error("❌ sync-motherboards 실패", err);
    res.status(500).json({ error: "sync-motherboards 실패" });
  }
});

export default router;
