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
      // Cloudflare 등 프록시 앞에 있으면 필요시 withCredentials나 쿠키 주입 고려
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

/** 리스트에서 제품명+상세 링크 수집 (선택자 다중 시도) */
function extractList($) {
  const items = [];
  const seen = new Set();

  // 1) 앵커로 직접 연결된 카드
  $('a[href^="/en/motherboard/"]').each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    // 이름 찾기: a 텍스트 또는 자식 strong/h3/span
    let name = $(a).text().trim();
    if (!name) {
      name =
        $(a).find("strong, h3, h2, .title, .name, span").first().text().trim();
    }
    const abs = href.startsWith("http") ? href : `${ORIGIN}${href.split("?")[0]}`;
    const key = `${name}::${abs}`;
    if (!name || seen.has(key)) return;
    seen.add(key);
    items.push({ name, url: abs });
  });

  // 2) 카드 컴포넌트 안의 제목 블록(만약 a가 바깥에 있을 때)
  if (items.length === 0) {
    // 폭 넓은 탐색: 카드 컨테이너 추정
    $('div, article')
      .filter((_, el) => /card|product|tile/i.test($(el).attr("class") || ""))
      .each((_, card) => {
        const name =
          $(card).find("a").first().text().trim() ||
          $(card).find("strong,h3,h2,.title,.name,span").first().text().trim();
        const href = $(card).find('a[href^="/en/motherboard/"]').attr("href");
        if (!name || !href) return;
        const abs = href.startsWith("http") ? href : `${ORIGIN}${href.split("?")[0]}`;
        const key = `${name}::${abs}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ name, url: abs });
      });
  }

  return items;
}

/** 상세에서 칩셋/소켓 텍스트 추출 (다중 방식) */
function extractChipsetOrSocket($) {
  // 0) 페이지 전체 텍스트 캐시
  const fullText = $("body").text().replace(/\s+/g, " ").trim();

  // 1) 테이블 기반
  let val = null;
  $("table tr").each((_, tr) => {
    const left = $(tr).find("th,td").first().text().trim().toLowerCase();
    const right = $(tr).find("td,th").eq(1).text().trim();
    if (!right) return;
    if (/chipset/i.test(left)) {
      val = `Chipset: ${right}`;
    } else if (/cpu socket|socket/i.test(left)) {
      // 어떤 페이지는 'CPU socket' 또는 'Socket'으로만 노출되는 경우가 있음
      val = `Chipset: ${right}`; // 저장 형식은 "info"에 통일: Chipset: ...
    }
  });
  if (val) return val;

  // 2) 정의 리스트/카드형 라벨 구조
  $('li, div, section, p, span, dt, dd').each((_, el) => {
    const txt = $(el).text().trim();
    if (!txt) return;
    const m1 = txt.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
    if (m1 && m1[1]) {
      val = `Chipset: ${m1[1].trim()}`;
      return false;
    }
    const m2 = txt.match(/(cpu\s*socket|socket)\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
    if (m2 && m2[2]) {
      val = `Chipset: ${m2[2].trim()}`;
      return false;
    }
  });
  if (val) return val;

  // 3) JSON-LD(구조화 데이터) 내부에서 name/description 힌트 검색
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const t = $(s).contents().text();
      const j = JSON.parse(t);
      const desc = Array.isArray(j) ? j.map(x => x?.description).join(" ") : j?.description;
      const str = `${j?.name || ""} ${desc || ""}`;
      const m1 = str.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
      if (m1 && m1[1]) {
        val = `Chipset: ${m1[1].trim()}`;
        return false;
      }
      const m2 = str.match(/(cpu\s*socket|socket)\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
      if (m2 && m2[2]) {
        val = `Chipset: ${m2[2].trim()}`;
        return false;
      }
    } catch {}
  });
  if (val) return val;

  // 4) 마지막 수단: 전체 텍스트에서 정규식
  const m1 = fullText.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]{2,20})/i);
  if (m1 && m1[1]) return `Chipset: ${m1[1].trim()}`;
  const m2 = fullText.match(/(cpu\s*socket|socket)\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]{2,20})/i);
  if (m2 && m2[2]) return `Chipset: ${m2[2].trim()}`;

  return ""; // 못 찾음
}

async function fetchList(pageCount = 2) {
  const out = [];
  for (let p = 1; p <= pageCount; p++) {
    const url = LIST_URL(p);
    console.log(`🔎 리스트 요청: ${url}`);
    const html = await fetchHtml(url);
    if (!html) { console.log("⛔ 리스트 HTML 없음"); continue; }
    const $ = cheerio.load(html);
    const items = extractList($);
    console.log(`📃 ${p}페이지 수집: ${items.length}개`);
    out.push(...items);
    await sleep(800);
  }
  return out;
}

async function fetchDetailInfo(detailUrl) {
  const html = await fetchHtml(detailUrl);
  if (!html) return { info: "" };
  const $ = cheerio.load(html);
  const info = extractChipsetOrSocket($); // "Chipset: LGA1581" 같은 형식
  if (!info) console.log(`⚠️ 칩셋/소켓 미추출: ${detailUrl}`);
  return { info };
}

async function saveToDB(list) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "motherboard" }).toArray();
  const byName = new Map(existing.map(x => [x.name, x]));

  for (const it of list) {
    const old = byName.get(it.name);
    const update = {
      category: "motherboard",
      info: it.info || "",  // 요청하신 필드명으로 저장
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log(`🔁 업데이트: ${it.name} | ${it.info || "—"}`);
    } else {
      await col.insertOne({
        name: it.name,
        ...update,
        priceHistory: [],
      });
      console.log(`🆕 삽입: ${it.name} | ${it.info || "—"}`);
    }
    await sleep(250);
  }
}

/** 실행 라우터
 * POST /api/sync-motherboards
 * body: { pages?: number, limit?: number }
 */
router.post("/sync-motherboards", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 2;
    const hardLimit = Number(req?.body?.limit) || 40; // 과도한 상세 요청 방지
    res.json({ message: `✅ 메인보드 동기화 시작 (pages=${pages}, limit=${hardLimit})` });

    setImmediate(async () => {
      const list = await fetchList(pages);

      // 상세에서 info 추출
      const enriched = [];
      for (const it of list.slice(0, hardLimit)) {
        console.log(`🔬 상세 파싱: ${it.name} → ${it.url}`);
        const { info } = await fetchDetailInfo(it.url);
        enriched.push({ ...it, info });
        await sleep(400);
      }

      await saveToDB(enriched);
      console.log("🎉 메인보드 저장 완료");
    });
  } catch (err) {
    console.error("❌ sync-motherboards 실패", err);
    res.status(500).json({ error: "sync-motherboards 실패" });
  }
});

export default router;
