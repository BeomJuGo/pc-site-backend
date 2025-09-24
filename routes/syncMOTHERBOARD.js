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
      await sleep(1000 + 300 * tryCount);
      return fetchHtml(url, tryCount + 1);
    }
    console.log(`❌ 요청 실패: ${url} (${e?.response?.status || e.message})`);
    return null;
  }
}

/** /en/<slug> 한 단계만 제품 후보로 인정. /en/motherboard/* 등은 제외 */
function isOneLevelProductHref(href) {
  if (!href?.startsWith("/en/")) return false;
  if (href.startsWith("/en/motherboard/")) return false; // 허브/가이드 제외
  if (href.startsWith("/en/compare/")) return false;     // 비교 페이지 제외
  const path = href.split("?")[0];
  const parts = path.split("/").filter(Boolean); // ["en","slug"]
  return parts.length === 2; // 정확히 /en/<slug>
}

/** 리스트 페이지에서 후보 URL 수집 */
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

/** 이름 정제: 꼬리표/불필요 구문 제거 */
function cleanProductName(nameRaw = "") {
  let name = nameRaw
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .trim();

  // 흔한 꼬리표 제거: "review: ...", "specs and price", "price and specs" 등
  name = name.replace(/\s*[-–—]?\s*review[:\s].*$/i, "");
  name = name.replace(/\s*[-–—]?\s*specs\s*(and|&)\s*price.*$/i, "");
  name = name.replace(/\s*[-–—]?\s*price\s*(and|&)\s*specs.*$/i, "");
  name = name.replace(/\s*[-–—]?\s*features\s*and\s*specs.*$/i, "");
  name = name.replace(/\s*[-–—]?\s*full\s*specs.*$/i, "");
  name = name.replace(/\s*[-–—]?\s*vs\s.*$/i, "");
  name = name.replace(/\s*[-–—]?\s*versus\s.*$/i, "");

  // 과한 공백 정리
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

/** 상세에서 제품명 추출 (h1 → og:title → title) 후 정제 */
function extractProductName($) {
  const h1 = $("h1").first().text().trim();
  if (h1) return cleanProductName(h1);

  const og = $('meta[property="og:title"]').attr("content");
  if (og) return cleanProductName(og);

  const title = $("title").text().trim();
  return cleanProductName(title || "");
}

/** 소켓 토큰만 깔끔히 뽑아내기 (AM5/AM4/LGA####/sTRX4/TR4 등) */
function extractSocketToken(text = "") {
  // 가장 흔한 패턴들에 대한 우선순위 매칭
  const TOKEN_PATTERNS = [
    /\b(AM5|AM4)\b/i,
    /\b(LGA\s?\d{3,4})\b/i,       // LGA1700, LGA 1851, LGA1581 등
    /\b(s?TRX4|TR4)\b/i,          // HEDT
    /\b(LGA\s?\d{3,4}\s?-\s?\d{3,4})\b/i, // 드물게 범위 표기
  ];

  for (const re of TOKEN_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) return m[1].replace(/\s+/g, "").toUpperCase().replace(/^LGA(\d+)/, "LGA$1");
    if (m?.[0]) return m[0].replace(/\s+/g, "").toUpperCase().replace(/^LGA(\d+)/, "LGA$1");
  }

  // 친화도 낮은 백업: "Socket: <token>" 형태를 직접 긁음
  const mSock = text.match(/socket\s*[:•\-]?\s*([A-Za-z0-9\s\-]+)/i);
  if (mSock?.[1]) {
    const t = mSock[1].trim();
    return extractSocketToken(t); // 재귀 정제
  }

  return ""; // 못 찾음
}

/** 상세에서 소켓 텍스트를 우선 추출 → "Socket: <TOKEN>" */
function extractSocketInfo($) {
  // 1) 표 기반 우선
  let info = "";
  $("table tr").each((_, tr) => {
    const left = $(tr).find("th,td").first().text().trim();
    const right = $(tr).find("td,th").eq(1).text().trim();
    if (!left || !right) return;

    if (/socket/i.test(left) || /cpu\s*socket/i.test(left)) {
      const token = extractSocketToken(`${left} ${right}`);
      if (token) { info = `Socket: ${token}`; return false; }
    }
    // 일부 표는 Chipset 옆에 소켓도 함께 쓰이는 경우가 있어 전체 텍스트에서 토큰 탐색
    if (/chipset/i.test(left)) {
      const token = extractSocketToken(`${left} ${right}`);
      if (token) { info = `Socket: ${token}`; return false; }
    }
  });
  if (info) return info;

  // 2) 라벨/정의/카드형/자유텍스트
  const blocks = [];
  $('li, div, section, p, span, dt, dd').each((_, el) => {
    const t = $(el).text().trim();
    if (t) blocks.push(t);
  });
  const token2 = extractSocketToken(blocks.slice(0, 150).join(" | "));
  if (token2) return `Socket: ${token2}`;

  // 3) JSON-LD 내부
  let fromJson = "";
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const t = $(s).contents().text();
      const j = JSON.parse(t);
      const texts = [];
      if (Array.isArray(j)) j.forEach(x => texts.push(x?.name, x?.description));
      else texts.push(j?.name, j?.description);
      const str = texts.filter(Boolean).join(" ");
      const tok = extractSocketToken(str);
      if (tok) { fromJson = `Socket: ${tok}`; throw new Error("_break_"); }
    } catch (e) {
      if (e.message === "_break_") return false;
    }
  });
  if (fromJson) return fromJson;

  // 4) 최후: 본문 전체에서 토큰 직탐
  const full = $("body").text().replace(/\s+/g, " ").trim();
  const tok = extractSocketToken(full);
  if (tok) return `Socket: ${tok}`;

  return ""; // 못 찾으면 빈값
}

/** 최소 검증: ‘motherboard’ 키워드 포함 + socket/chipset 단어 중 하나라도 페이지에 존재 */
function isLikelyMotherboardPage($) {
  const body = $("body").text().toLowerCase();
  const hasMotherboard = body.includes("motherboard");
  const hasSpecHint = body.includes("socket") || body.includes("chipset");
  return hasMotherboard && hasSpecHint;
}

/** 리스트 후보 모으기 */
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
    await sleep(500);
  }
  console.log(`✅ 중복제거 후 후보 합계: ${out.size}건`);
  return Array.from(out);
}

/** 상세 파싱 */
async function parseDetail(u) {
  const html = await fetchHtml(u);
  if (!html) return null;
  const $ = cheerio.load(html);

  const name = extractProductName($);
  if (!name) { console.log(`⛔ 이름 미발견: ${u}`); return null; }

  const info = extractSocketInfo($);
  const isBoard = isLikelyMotherboardPage($);

  console.log(`🔬 파싱: name="${name}", info="${info}", url=${u}`);
  if (!isBoard) console.log(`⚠️ 메인보드 페이지로 확신 부족: ${u}`);
  if (!info) console.log(`⚠️ 소켓 정보 미발견: ${u}`);

  return { name, info };
}

/** DB 저장 (가격 비터치) */
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
    await sleep(150);
  }
}

/** 실행 라우터
 * POST /api/sync-motherboards
 * body: { pages?: number, limit?: number }
 */
router.post("/sync-motherboards", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 2;
    const hardLimit = Number(req?.body?.limit) || 60;

    res.json({ message: `✅ 메인보드 동기화 시작 (pages=${pages}, limit=${hardLimit})` });

    setImmediate(async () => {
      const cand = await collectCandidates(pages);
      const picked = [];
      for (const u of cand.slice(0, hardLimit)) {
        const parsed = await parseDetail(u);
        if (!parsed) continue;
        picked.push(parsed);
        await sleep(350);
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
