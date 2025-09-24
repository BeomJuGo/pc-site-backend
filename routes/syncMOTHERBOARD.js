// routes/syncMOTHERBOARD.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const router = express.Router();

/**
 * 참고:
 * - 리스트 페이지: https://versus.com/en/motherboard?page=1,2,...
 * - 상세 페이지: /en/motherboard/<slug>
 * 구조가 변경될 수 있으므로, 선택자는 최대한 보수적으로/견고하게 작성함.
 */

const ORIGIN = "https://versus.com";
const BASE_LIST = `${ORIGIN}/en/motherboard`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTML GET (UA 지정 & 타임아웃 & 재시도) */
async function fetchHtml(url, tryCount = 0) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 20000,
    });
    return res.data;
  } catch (err) {
    if (tryCount < 2) {
      console.log(`⚠️ 재시도 ${tryCount + 1}: ${url}`);
      await sleep(1200);
      return fetchHtml(url, tryCount + 1);
    }
    console.log(`❌ 요청 실패: ${url}`);
    return null;
  }
}

/** 리스트 페이지에서 상세 링크 + 이름 수집 */
async function fetchMotherboardList(maxPages = 3) {
  const items = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_LIST}?page=${page}`;
    console.log(`🔎 리스트 페이지: ${url}`);

    const html = await fetchHtml(url);
    if (!html) continue;

    const $ = cheerio.load(html);

    // 1) 가장 안전한: /en/motherboard/ 슬러그 링크 수집
    $('a[href^="/en/motherboard/"]').each((_, a) => {
      const href = $(a).attr("href");
      let name = $(a).text().trim();

      // 카드/타일 구조에서 텍스트가 비어있으면 자식 엘리먼트 탐색
      if (!name) {
        name = $(a).find("*").first().text().trim();
      }
      if (!href || !name) return;

      const slug = href.split("?")[0];
      const abs = slug.startsWith("http") ? slug : `${ORIGIN}${slug}`;
      const key = `${name}::${abs}`;
      if (seen.has(key)) return;

      // 메인보드가 아닌 비교 링크 등 제외 (휴리스틱)
      if (!/\/en\/motherboard\//.test(abs)) return;

      seen.add(key);
      items.push({ name, url: abs });
    });

    // 페이지당 너무 많으면 과도한 요청 방지
    await sleep(800);
  }

  console.log(`✅ 리스트 수집 완료: ${items.length}개`);
  return items;
}

/** 상세 페이지에서 칩셋 추출 */
function extractChipsetFrom($) {
  // 표 기반: <table><tr><th>Chipset</th><td>...</td></tr></table>
  let chipset = null;
  $("table tr").each((_, tr) => {
    const th = $(tr).find("th,td").first().text().trim().toLowerCase();
    const td = $(tr).find("td,th").eq(1).text().trim();
    if (/chipset/i.test(th) && td) {
      chipset = td;
    }
  });
  if (chipset) return chipset;

  // 정의 리스트, 카드 스펙 등 다양한 마크업 대응
  // 라벨에 'Chipset'가 포함된 경우 인접 텍스트를 추출
  const candidates = $("li,div,section,p,span,dt,dd");
  candidates.each((_, el) => {
    const txt = $(el).text().trim();
    if (!txt) return;
    // 예: "Chipset: B760", "Chipset • X670E" 등
    const m = txt.match(/chipset\s*[:•\-]?\s*([A-Za-z0-9\-\+\s\/]+)/i);
    if (m && m[1]) {
      chipset = m[1].trim();
      return false;
    }
  });

  return chipset || "";
}

async function fetchChipset(detailUrl) {
  const html = await fetchHtml(detailUrl);
  if (!html) return "";

  const $ = cheerio.load(html);
  const chipset = extractChipsetFrom($);
  if (!chipset) console.log(`⚠️ 칩셋 미발견: ${detailUrl}`);
  return chipset;
}

/** MongoDB 저장 (가격/이미지/히스토리 비터치) */
async function saveMotherboardsToDB(list) {
  const db = getDB();
  const col = db.collection("parts");

  // 기존 목록
  const existing = await col.find({ category: "motherboard" }).toArray();
  const byName = new Map(existing.map((e) => [e.name, e]));
  const nowNames = new Set(list.map((x) => x.name));

  for (const item of list) {
    const doc = byName.get(item.name);
    const update = {
      category: "motherboard",
      chipset: item.chipset || "",
      // 옵션: specSummary에 칩셋 요약을 넣고 싶다면 아래 주석 해제
      // specSummary: item.chipset ? `Chipset: ${item.chipset}` : (doc?.specSummary ?? ""),
    };

    if (doc) {
      await col.updateOne({ _id: doc._id }, { $set: update });
      console.log(`🔁 업데이트: ${item.name} (${item.chipset || "—"})`);
    } else {
      await col.insertOne({
        name: item.name,
        ...update,
        priceHistory: [], // 신규는 빈 히스토리
      });
      console.log(`🆕 삽입: ${item.name} (${item.chipset || "—"})`);
    }
    await sleep(400); // 서버 부하/차단 방지
  }

  // 리스트에 더 이상 없는 항목 정리(원하면 주석 해제)
  // const toDelete = existing.filter((e) => !nowNames.has(e.name)).map((e) => e.name);
  // if (toDelete.length) {
  //   await col.deleteMany({ category: "motherboard", name: { $in: toDelete } });
  //   console.log(`🗑️ 삭제: ${toDelete.length}개`);
  // }
}

/** 실행 라우터: POST /api/sync-motherboards
 *  body: { pages?: number }  // 기본 3페이지
 */
router.post("/sync-motherboards", async (req, res) => {
  try {
    const pages = Number(req?.body?.pages) || 3;

    res.json({ message: `✅ 메인보드 동기화 시작 (pages=${pages})` });

    setImmediate(async () => {
      const list = await fetchMotherboardList(pages);

      // 상세 페이지에서 칩셋 추출 (직렬로 진행: 사이트 차단 방지)
      const enriched = [];
      for (const it of list) {
        const chipset = await fetchChipset(it.url);
        enriched.push({ ...it, chipset });
        await sleep(500);
      }

      await saveMotherboardsToDB(enriched);
      console.log("🎉 메인보드 저장 완료");
    });
  } catch (err) {
    console.error("❌ sync-motherboards 실패", err);
    res.status(500).json({ error: "sync-motherboards 실패" });
  }
});

export default router;
