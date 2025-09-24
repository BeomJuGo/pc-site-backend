// routes/syncMEMORY.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const router = express.Router();

const ORIGIN = "https://versus.com";
const LIST_URL = (p) => `${ORIGIN}/en/memory?page=${p}`;
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

/** /en/<slug> 한 단계만 제품으로 인정. /en/memory/*, /en/compare/* 등은 제외 */
function isOneLevelProductHref(href) {
  if (!href?.startsWith("/en/")) return false;
  if (href.startsWith("/en/memory/")) return false; // 허브/가이드 제외
  if (href.startsWith("/en/compare/")) return false; // 비교 페이지 제외
  const path = href.split("?")[0];
  const parts = path.split("/").filter(Boolean); // ["en","slug"]
  return parts.length === 2;
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

/** 상세에서 제품명 추출 */
function extractProductName($) {
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;
  const og = $('meta[property="og:title"]').attr("content");
  if (og) return og.trim();
  const title = $("title").text().trim();
  return title || "";
}

/** 텍스트에서 메모리 스펙 추출 → info 문자열 생성 */
function buildMemoryInfoFromText(str) {
  if (!str) return "";

  // 정규식 패턴
  const typeMatch = str.match(/\b(DDR[2-5])\b/i);                   // DDR4, DDR5
  const speedMatch =
    str.match(/\b(\d{4,5})\s*MHz\b/i) ||                           // 3200 MHz, 6000 MHz
    str.match(/\b(\d{4,5})\s*MT\/s\b/i) ||                         // 6400 MT/s
    str.match(/\bDDR[2-5]-?(\d{3,5})\b/i);                         // DDR5-6400
  const kitMatch =
    str.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\s*GB\b/i) ||            // 2x16 GB
    str.match(/\b(\d{1,3})\s*GB\s*\(\s*(\d{1,2})\s*x\s*(\d{1,3})\s*GB\)/i); // 32GB (2x16GB)
  const capacityMatch = str.match(/\b(\d{1,3})\s*GB\b/i);          // 32GB
  const clMatch =
    str.match(/\bCL\s*([0-9]{1,2})\b/i) ||
    str.match(/\bCAS\s*Latency\s*([0-9]{1,2})\b/i);

  let type = typeMatch ? typeMatch[1].toUpperCase() : "";
  let speed = speedMatch ? speedMatch[1] : "";
  let capacity = "";
  if (kitMatch) {
    const a = parseInt(kitMatch[1], 10);
    const b = parseInt(kitMatch[2], 10);
    if (!isNaN(a) && !isNaN(b)) {
      capacity = `${a}x${b}GB (${a * b}GB)`;
    }
  } else if (capacityMatch) {
    capacity = `${capacityMatch[1]}GB`;
  }
  let cl = clMatch ? clMatch[1] : "";

  // info 문자열 구성
  const parts = [];
  if (type) parts.push(`Type: ${type}`);
  if (speed) parts.push(`Speed: ${speed} MHz`);
  if (capacity) parts.push(`Capacity: ${capacity}`);
  if (cl) parts.push(`CL: ${cl}`);

  return parts.join(", ");
}

/** 상세에서 info 추출 (테이블/라벨/JSON-LD/문장패턴) */
function extractMemoryInfo($) {
  // 표 형태 우선
  const rows = [];
  $("table tr").each((_, tr) => {
    const k = $(tr).find("th,td").first().text().trim();
    const v = $(tr).find("td,th").eq(1).text().trim();
    if (k && v) rows.push(`${k}: ${v}`);
  });
  let info = buildMemoryInfoFromText(rows.join(" | "));
  if (info) return info;

  // 라벨/정의/카드 텍스트
  const blocks = [];
  $('li, div, section, p, span, dt, dd').each((_, el) => {
    const t = $(el).text().trim();
    if (t) blocks.push(t);
  });
  info = buildMemoryInfoFromText(blocks.slice(0, 100).join(" | "));
  if (info) return info;

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const t = $(s).contents().text();
      const j = JSON.parse(t);
      const texts = [];
      if (Array.isArray(j)) j.forEach(x => texts.push(x?.name, x?.description));
      else texts.push(j?.name, j?.description);
      const str = texts.filter(Boolean).join(" ");
      const candidate = buildMemoryInfoFromText(str);
      if (candidate) { info = candidate; throw new Error("_break_"); }
    } catch (e) {
      if (e.message === "_break_") return false;
    }
  });
  if (info) return info;

  // 최후: 본문 전체
  const full = $("body").text().replace(/\s+/g, " ").trim();
  return buildMemoryInfoFromText(full);
}

/** 리스트 수집 */
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

/** 상세 파싱 */
async function fetchDetail(u) {
  const html = await fetchHtml(u);
  if (!html) return null;
  const $ = cheerio.load(html);
  const name = extractProductName($);
  if (!name) { console.log(`⛔ 이름 미발견: ${u}`); return null; }

  const info = extractMemoryInfo($);
  if (!info) console.log(`⚠️ 메모리 info 미발견: ${u}`);

  return { name, info };
}

/** DB 저장 (가격/이미지 비터치) */
async function saveToDB(list) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "memory" }).toArray();
  const byName = new Map(existing.map(x => [x.name, x]));

  for (const it of list) {
    const old = byName.get(it.name);
    const update = { category: "memory", info: it.info || "" };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log(`🔁 업데이트: ${it.name} | ${it.info || "—"}`);
    } else {
      await col.insertOne({ name: it.name, ...update, priceHistory: [] });
      console.log(`🆕 삽입: ${it.name} | ${it.info || "—"}`);
    }
    await sleep(180);
  }
}

/** 실행 라우터
 * POST /api/sync-memory
 * body: { pages?: number, limit?: number }
 */
router.post("/sync-memory", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 2;
    const hardLimit = Number(req?.body?.limit) || 60;

    res.json({ message: `✅ 메모리 동기화 시작 (pages=${pages}, limit=${hardLimit})` });

    setImmediate(async () => {
      const cand = await collectCandidates(pages);
      const picked = [];
      for (const u of cand.slice(0, hardLimit)) {
        console.log(`🔬 상세 파싱: ${u}`);
        const info = await fetchDetail(u);
        if (!info) continue;
        picked.push(info);
        await sleep(350);
      }
      if (picked.length === 0) {
        console.log("⛔ 저장할 항목 없음 (후보 0)");
        return;
      }
      await saveToDB(picked);
      console.log("🎉 메모리 저장 완료");
    });
  } catch (err) {
    console.error("❌ sync-memory 실패", err);
    res.status(500).json({ error: "sync-memory 실패" });
  }
});

export default router;
