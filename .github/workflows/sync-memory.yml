// routes/syncMEMORY.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const router = express.Router();

const ORIGIN = "https://versus.com";
const LIST_URL = (p) => `${ORIGIN}/en/memory?page=${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------ */
/* HTTP 요청 유틸                        */
/* ------------------------------------ */
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

/* ------------------------------------ */
/* 리스트 후보 판별/수집                 */
/* ------------------------------------ */
function isOneLevelProductHref(href) {
  if (!href?.startsWith("/en/")) return false;
  if (href.startsWith("/en/memory/")) return false;   // 허브/가이드 제외
  if (href.startsWith("/en/compare/")) return false;  // 비교 페이지 제외
  const path = href.split("?")[0];
  const parts = path.split("/").filter(Boolean); // ["en","slug"]
  return parts.length === 2; // 정확히 /en/<slug> → 제품 후보
}

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

/* ------------------------------------ */
/* 이름/스펙 정제                        */
/* ------------------------------------ */
function cleanProductName(nameRaw = "") {
  let name = (nameRaw || "")
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014]/g, "-") // – — → -
    .trim();

  // 1) 흔한 꼬리표/구분자 패턴들을 과감히 제거
  //   예: "… review: specs and price", "… specs and price", "… price and specs", "… full specs"
  name = name.replace(/\s*[-–—:|]?\s*review[:\s].*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*specs?\s*(and|&)\s*price.*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*price\s*(and|&)\s*specs?.*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*full\s*specs?.*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*features\s*and\s*specs?.*$/i, "");

  // 2) 비교/대상 표기 제거
  name = name.replace(/\s*[-–—:|]?\s*vs\s+.*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*versus\s+.*$/i, "");

  // 3) 사이트 브랜딩 꼬리표 제거 (on Versus, | Versus 등)
  name = name.replace(/\s*[-–—:|]?\s*on\s+versus\s*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*versus\s*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*\|\s*versus\s*$/i, "");
  name = name.replace(/\s*[-–—:|]?\s*–\s*versus\s*$/i, "");

  // 4) 뒤에 붙은 불필요한 괄호/구문 정리(너무 공격적이지 않게 공백 재정리)
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

/** 텍스트 덩어리에서 메모리 스펙 추출 → info 문자열 생성 (Type/Speed/Capacity/CL) */
function buildMemoryInfoFromText(str) {
  if (!str) return "";

  const typeMatch = str.match(/\b(DDR[2-5])\b/i);                  // DDR4, DDR5
  const speedMatch =
    str.match(/\b(\d{4,5})\s*MHz\b/i) ||                          // 3200 MHz, 6000 MHz
    str.match(/\b(\d{4,5})\s*MT\/s\b/i) ||                        // 6400 MT/s
    str.match(/\bDDR[2-5]-?(\d{3,5})\b/i);                        // DDR5-6400
  const kitMatch =
    str.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\s*GB\b/i) ||           // 2x16 GB
    str.match(/\b(\d{1,3})\s*GB\s*\(\s*(\d{1,2})\s*x\s*(\d{1,3})\s*GB\)/i); // 32GB (2x16GB)
  const capacityMatch = str.match(/\b(\d{1,3})\s*GB\b/i);         // 32GB
  const clMatch =
    str.match(/\bCL\s*([0-9]{1,2})\b/i) ||
    str.match(/\bCAS\s*Latency\s*([0-9]{1,2})\b/i);

  const type = typeMatch ? typeMatch[1].toUpperCase() : "";
  const speed = speedMatch ? speedMatch[1] : "";

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

  const cl = clMatch ? clMatch[1] : "";

  const parts = [];
  if (type) parts.push(`Type: ${type}`);
  if (speed) parts.push(`Speed: ${speed} MHz`);
  if (capacity) parts.push(`Capacity: ${capacity}`);
  if (cl) parts.push(`CL: ${cl}`);
  return parts.join(", ");
}

/* ------------------------------------ */
/* 상세 페이지 파서                      */
/* ------------------------------------ */
function extractProductName($) {
  const h1 = $("h1").first().text().trim();
  if (h1) return cleanProductName(h1);

  const og = $('meta[property="og:title"]').attr("content");
  if (og) return cleanProductName(og);

  const title = $("title").text().trim();
  return cleanProductName(title || "");
}

/** 표/라벨/JSON-LD/본문에서 info 구성 */
function extractMemoryInfo($) {
  // 1) 표 기반
  const rows = [];
  $("table tr").each((_, tr) => {
    const k = $(tr).find("th,td").first().text().trim();
    const v = $(tr).find("td,th").eq(1).text().trim();
    if (k && v) rows.push(`${k}: ${v}`);
  });
  let info = buildMemoryInfoFromText(rows.join(" | "));
  if (info) return info;

  // 2) 라벨/정의/카드형/자유 텍스트
  const blocks = [];
  $('li, div, section, p, span, dt, dd').each((_, el) => {
    const t = $(el).text().trim();
    if (t) blocks.push(t);
  });
  info = buildMemoryInfoFromText(blocks.slice(0, 150).join(" | "));
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
      const candidate = buildMemoryInfoFromText(str);
      if (candidate) { info = candidate; throw new Error("_break_"); }
    } catch (e) {
      if (e.message === "_break_") return false;
    }
  });
  if (info) return info;

  // 4) 최후: 본문 전체
  const full = $("body").text().replace(/\s+/g, " ").trim();
  return buildMemoryInfoFromText(full);
}

/* ------------------------------------ */
/* 수집/저장 로직                        */
/* ------------------------------------ */
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

async function parseDetail(u) {
  const html = await fetchHtml(u);
  if (!html) return null;
  const $ = cheerio.load(html);

  const name = extractProductName($);
  if (!name) { console.log(`⛔ 이름 미발견: ${u}`); return null; }

  const info = extractMemoryInfo($);
  console.log(`🔬 파싱: name="${name}", info="${info}", url=${u}`);
  if (!info) console.log(`⚠️ 메모리 info 미발견: ${u}`);

  return { name, info };
}

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

/* ------------------------------------ */
/* 과거 문서 정리 (이름 꼬리표 제거)     */
/* ------------------------------------ */
function cleanupName(name = "") {
  return cleanProductName(name);
}
function cleanupInfo(info = "") {
  // info는 이미 Type/Speed/Capacity/CL만 추출해 만든 형태라
  // 굳이 다시 파싱할 필요가 없지만, 혹시 쓸데없는 텍스트가 섞였으면 최소 정리
  if (typeof info !== "string") return "";
  return info.replace(/\s+/g, " ").trim();
}

async function cleanupOldMemoryDocs() {
  const db = getDB();
  const col = db.collection("parts");
  const docs = await col.find({ category: "memory" }).toArray();

  let renamed = 0, reinfo = 0;
  for (const d of docs) {
    const newName = cleanupName(d.name);
    const newInfo = cleanupInfo(d.info);

    const set = {};
    if (newName && newName !== d.name) { set.name = newName; renamed++; }
    if (typeof d.info === "string" && newInfo !== d.info) { set.info = newInfo; reinfo++; }

    if (Object.keys(set).length > 0) {
      await col.updateOne({ _id: d._id }, { $set: set });
      console.log(`🧹 정리됨: ${d._id} | name:"${d.name}"→"${set.name ?? d.name}" | info:"${d.info}"→"${set.info ?? d.info}"`);
    }
  }
  return { renamed, reinfo, total: docs.length };
}

/* ------------------------------------ */
/* 라우터                                */
/* ------------------------------------ */

// 크롤링 & 저장
// POST /api/sync-memory
// body: { pages?: number, limit?: number }
router.post("/sync-memory", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 2;
    const hardLimit = Number(req?.body?.limit) || 60;

    res.json({ message: `✅ 메모리 동기화 시작 (pages=${pages}, limit=${hardLimit})` });

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
      console.log("🎉 메모리 저장 완료");
    });
  } catch (err) {
    console.error("❌ sync-memory 실패", err);
    res.status(500).json({ error: "sync-memory 실패" });
  }
});

// 과거 데이터 정리 (이름 꼬리표 제거)
// POST /api/cleanup-memory
router.post("/cleanup-memory", async (req, res) => {
  try {
    const result = await cleanupOldMemoryDocs();
    res.json({ message: "✅ 정리 완료", ...result });
  } catch (err) {
    console.error("❌ cleanup-memory 실패", err);
    res.status(500).json({ error: "cleanup-memory 실패" });
  }
});

export default router;
