// routes/syncMOTHERBOARD.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const ORIGIN = "https://versus.com";
const LIST_URL = (p) => `${ORIGIN}/en/motherboard?page=${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ====== OpenAI ======
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
async function fetchAiOneLiner({ name, info }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정: AI 한줄평 생략");
    return { review: "", specSummary: "" };
  }
  const prompt = `
당신은 PC 부품 추천 전문가입니다. 아래 메인보드 정보를 바탕으로 한국어로 짧고 간결한 한줄평과 핵심 스펙 요약을 만들어 주세요.

[제품명]
${name}

[핵심 정보]
${info || "-"}

[요구사항]
- 한줄평(review): 1문장, 100자 이내, 과장 금지, 초보자도 이해하기 쉬운 표현
- 스펙 요약(specSummary): 1문장, 100자 이내, 소켓/칩셋/대략적 용도(게이밍/크리에이티브/보급형 등) 포함
- JSON만 출력, 설명/불릿/코드블록 불가

형식:
{
  "review": "<한줄평>",
  "specSummary": "<요약>"
}
  `.trim();

  // 재시도(최대 3회, 지수 백오프)
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
          temperature: 0.4,
          messages: [
            { role: "system", content: "너는 PC 부품 요약/추천 전문가야." },
            { role: "user", content: prompt },
          ],
        }),
      });
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}") + 1;
      const jsonStr = raw.slice(start, end);
      const parsed = JSON.parse(jsonStr);
      return {
        review: typeof parsed.review === "string" ? parsed.review.trim() : "",
        specSummary: typeof parsed.specSummary === "string" ? parsed.specSummary.trim() : "",
      };
    } catch (e) {
      const wait = 800 * Math.pow(2, i);
      console.log(`⚠️ AI 한줄평 실패(시도 ${i + 1}): ${e.message} → ${wait}ms 대기 후 재시도`);
      await sleep(wait);
    }
  }
  return { review: "", specSummary: "" };
}

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
  if (href.startsWith("/en/motherboard/")) return false; // 허브/가이드 제외
  if (href.startsWith("/en/compare/")) return false;     // 비교 페이지 제외
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
/* 이름/소켓 정제                        */
/* ------------------------------------ */
function cleanProductName(nameRaw = "") {
  let name = nameRaw
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .trim();

  // 흔한 꼬리표 제거
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

function extractSocketToken(text = "") {
  const TOKEN_PATTERNS = [
    /\b(AM5|AM4)\b/i,
    /\b(LGA\s?\d{3,4})\b/i,
    /\b(s?TRX4|TR4)\b/i,
    /\b(LGA\s?\d{3,4}\s?-\s?\d{3,4})\b/i,
  ];
  for (const re of TOKEN_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) return m[1].replace(/\s+/g, "").toUpperCase().replace(/^LGA(\d+)/, "LGA$1");
    if (m?.[0]) return m[0].replace(/\s+/g, "").toUpperCase().replace(/^LGA(\d+)/, "LGA$1");
  }
  const mSock = text.match(/socket\s*[:•\-]?\s*([A-Za-z0-9\s\-]+)/i);
  if (mSock?.[1]) {
    const t = mSock[1].trim();
    return extractSocketToken(t);
  }
  return "";
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

function extractSocketInfo($) {
  // 1) 테이블 우선
  let info = "";
  $("table tr").each((_, tr) => {
    const left = $(tr).find("th,td").first().text().trim();
    const right = $(tr).find("td,th").eq(1).text().trim();
    if (!left || !right) return;

    if (/socket/i.test(left) || /cpu\s*socket/i.test(left)) {
      const token = extractSocketToken(`${left} ${right}`);
      if (token) { info = `Socket: ${token}`; return false; }
    }
    if (/chipset/i.test(left)) {
      const token = extractSocketToken(`${left} ${right}`);
      if (token) { info = `Socket: ${token}`; return false; }
    }
  });
  if (info) return info;

  // 2) 텍스트 블록
  const blocks = [];
  $('li, div, section, p, span, dt, dd').each((_, el) => {
    const t = $(el).text().trim();
    if (t) blocks.push(t);
  });
  const token2 = extractSocketToken(blocks.slice(0, 150).join(" | "));
  if (token2) return `Socket: ${token2}`;

  // 3) JSON-LD
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

  // 4) 최후: 본문 전체
  const full = $("body").text().replace(/\s+/g, " ").trim();
  const tok = extractSocketToken(full);
  if (tok) return `Socket: ${tok}`;

  return "";
}

function isLikelyMotherboardPage($) {
  const body = $("body").text().toLowerCase();
  const hasMotherboard = body.includes("motherboard");
  const hasSpecHint = body.includes("socket") || body.includes("chipset");
  return hasMotherboard && hasSpecHint;
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

  const info = extractSocketInfo($);
  const isBoard = isLikelyMotherboardPage($);

  console.log(`🔬 파싱: name="${name}", info="${info}", url=${u}`);
  if (!isBoard) console.log(`⚠️ 메인보드 페이지로 확신 부족: ${u}`);
  if (!info) console.log(`⚠️ 소켓 정보 미발견: ${u}`);

  return { name, info };
}

async function saveToDB(list, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "motherboard" }).toArray();
  const byName = new Map(existing.map(x => [x.name, x]));

  for (const it of list) {
    const old = byName.get(it.name);

    let review = "";
    let specSummary = "";
    if (ai) {
      // 기존에 review 있으면 스킵(강제 생성은 force)
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({ name: it.name, info: it.info });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "motherboard",
      info: it.info || "",
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log(`🔁 업데이트: ${it.name} | ${it.info || "—"} | review:${update.review ? "O" : "X"}`);
    } else {
      await col.insertOne({
        name: it.name,
        ...update,
        priceHistory: [],
      });
      console.log(`🆕 삽입: ${it.name} | ${it.info || "—"} | review:${update.review ? "O" : "X"}`);
    }
    await sleep(180); // OpenAI 레이트 제한 고려
  }
}

/* ------------------------------------ */
/* 과거 문서 정리 유틸                   */
/* ------------------------------------ */
function cleanupName(name = "") {
  return cleanProductName(name);
}
function cleanupInfo(info = "") {
  if (!info) return "";
  const token = extractSocketToken(info);
  return token ? `Socket: ${token}` : "";
}
async function cleanupOldDocs() {
  const db = getDB();
  const col = db.collection("parts");
  const docs = await col.find({ category: "motherboard" }).toArray();

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

// POST /api/sync-motherboards  body: { pages?: number, limit?: number, ai?: boolean, force?: boolean }
router.post("/sync-motherboards", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 2;
    const hardLimit = Number(req?.body?.limit) || 60;
    const ai = req?.body?.ai !== false;      // 기본 true
    const force = !!req?.body?.force;        // 기존 review 있어도 재생성

    res.json({ message: `✅ 메인보드 동기화 시작 (pages=${pages}, limit=${hardLimit}, ai=${ai}, force=${force})` });

    setImmediate(async () => {
      const cand = await collectCandidates(pages);
      const picked = [];
      for (const u of cand.slice(0, hardLimit)) {
        const parsed = await parseDetail(u);
        if (!parsed) continue;
        picked.push(parsed);
        await sleep(300);
      }

      if (picked.length === 0) {
        console.log("⛔ 저장할 항목 없음 (후보 0)");
        return;
      }

      await saveToDB(picked, { ai, force });
      console.log("🎉 메인보드 저장 완료");
    });
  } catch (err) {
    console.error("❌ sync-motherboards 실패", err);
    res.status(500).json({ error: "sync-motherboards 실패" });
  }
});

// 과거 오염 데이터 정리
router.post("/cleanup-motherboards", async (req, res) => {
  try {
    const result = await cleanupOldDocs();
    res.json({ message: "✅ 정리 완료", ...result });
  } catch (err) {
    console.error("❌ cleanup-motherboards 실패", err);
    res.status(500).json({ error: "cleanup-motherboards 실패" });
  }
});

export default router;
