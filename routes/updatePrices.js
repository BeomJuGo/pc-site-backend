// routes/updatePrices.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

/* ========================= 공통 유틸 ========================= */
const K_BLACKLIST = [
  "중고","리퍼","리퍼비시","벌크","채굴","해시","마이닝",
  "리뷰","후기","스펙","사양","가격비교","쿠폰","보증연장",
  "호환","호환성","케이블","연장","어댑터","라이저","브라켓","백플레이트","라이저카드",
  "테스트","교체","수리","서멀","구리스","팬교체","튜닝","ARGB","LED","라이팅",
  "키캡","방열판","서멀패드","확장카드","컨버터","케이스","케이스쿨러","파워","파워서플라이",
];
const K_REVIEW_TAIL = /(review[:\s].*|specs\s*(and|&)\s*price.*|price\s*(and|&)\s*specs.*|full\s*specs.*|features\s*and\s*specs.*)$/i;

function norm(s = "") {
  return s
    .replace(/[™®]/g, " ")
    .replace(/<[^>]+>/g, " ")      // Naver title의 태그 제거
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNameTail(name="") {
  return norm(name).replace(K_REVIEW_TAIL, "").replace(/\s+/g," ").trim();
}

function hasBlacklist(s = "") {
  const t = s.toLowerCase();
  return K_BLACKLIST.some(w => t.includes(w));
}

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : Math.floor((a[m-1]+a[m])/2);
}

function madFilter(prices, k = 3) {
  // Median Absolute Deviation 으로 아웃라이어 제거
  if (prices.length < 4) return prices; // 표본 적으면 스킵
  const m = median(prices);
  const absDev = prices.map(p => Math.abs(p - m));
  const mad = median(absDev) || 1;
  const lo = m - k * mad;
  const hi = m + k * mad;
  return prices.filter(p => p >= lo && p <= hi);
}

/* ============== 카테고리별 토큰/쿼리/가격범위 ============== */

function priceBoundsByCategory(category) {
  switch (category) {
    case "gpu":         return { min: 60000,  max: 6000000 };
    case "cpu":         return { min: 30000,  max: 3000000 };
    case "motherboard": return { min: 25000,  max: 1800000 };
    case "memory":      return { min: 10000,  max: 1500000 };
    default:            return { min: 10000,  max: 3000000 };
  }
}

function extractGpuTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  const brand = (n.match(/\b(ASUS|MSI|GIGABYTE|GALAX|COLORFUL|INNO3D|ZOTAC|PNY|PALIT|SAPPHIRE|POWERCOLOR|XFX|ASROCK)\b/) || [])[0];
  const series = (n.match(/\b(GEFORCE|RADEON)\b/) || [])[0];
  const model = (n.match(/\b(RTX|GTX|RX)\s*-?\s*\d{3,4}\s*(TI|SUPER|XT|XTX)?\b/) || [])[0];
  const vram  = (n.match(/\b(\d{1,3})\s*GB\b/) || [])[1];
  if (brand) tokens.push(brand);
  if (series) tokens.push(series);
  if (model) tokens.push(model.replace(/\s+/g," "));
  if (vram)  tokens.push(`${vram}GB`);
  return tokens;
}
function extractCpuTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  const amd = (n.match(/\b(RYZEN\s*[3579]|RYZEN\s?THREADRIPPER|ATHLON)\b/) || [])[0];
  const intel = (n.match(/\b(CORE\s*i[3579]|PENTIUM|CELERON)\b/) || [])[0];
  const gen = (n.match(/\b\d{3,5}(X3D|F|K|KF|KS)?\b/) || [])[0];
  if (amd) tokens.push(amd);
  if (intel) tokens.push(intel);
  if (gen) tokens.push(gen);
  return tokens;
}
function extractBoardTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  const brand = (n.match(/\b(ASUS|MSI|GIGABYTE|ASROCK|BIOSTAR)\b/) || [])[0];
  const chipset = (n.match(/\b(Z\d{3}|B\d{3}|H\d{3}|X\d{3}|A\d{3})\b/) || [])[0];
  const socket  = (n.match(/\b(AM4|AM5|LGA\s?\d{3,4})\b/) || [])[0];
  if (brand) tokens.push(brand);
  if (chipset) tokens.push(chipset.replace(/\s+/g,""));
  if (socket) tokens.push(socket.replace(/\s+/g,""));
  return tokens;
}
function extractMemoryTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  const brand = (n.match(/\b(G\.?SKILL|GSKILL|CORSAIR|KINGSTON|ADATA|TEAMGROUP|CRUCIAL|PATRIOT|SAMSUNG|MICRON)\b/) || [])[0];
  const ddr   = (n.match(/\b(DDR[2-5])\b/) || [])[0];
  const speed = (n.match(/\b(\d{4,5})\b/) || [])[1]; // 3200/6000 등
  const kit   = (n.match(/\b(\d{1,2})\s*X\s*(\d{1,3})\s*GB\b/) || []);
  const cap   = (n.match(/\b(\d{1,3})\s*GB\b/) || [])[1];
  const cl    = (n.match(/\bCL\s*\d{1,2}\b/) || [])[0];
  if (brand) tokens.push(brand.replace(/\./g,""));
  if (ddr) tokens.push(ddr);
  if (speed) tokens.push(speed);
  if (kit.length) tokens.push(`${kit[1]}X${kit[2]}GB`);
  else if (cap) tokens.push(`${cap}GB`);
  if (cl) tokens.push(cl.replace(/\s+/g,""));
  return tokens;
}

function tokensByCategory(name, category) {
  switch (category) {
    case "gpu":         return extractGpuTokens(name);
    case "cpu":         return extractCpuTokens(name);
    case "motherboard": return extractBoardTokens(name);
    case "memory":      return extractMemoryTokens(name);
    default:            return [];
  }
}

function queryVariants(name, category) {
  const base = cleanNameTail(name);
  switch (category) {
    case "gpu":
      return [
        `${base} 그래픽카드`,
        `${base} GPU`,
        `${base} 신품`,
      ];
    case "cpu":
      return [
        `${base} CPU`,
        `${base} 정품`,
      ];
    case "motherboard":
      return [
        `${base} 메인보드`,
        `${base} 메보`,
      ];
    case "memory":
      return [
        `${base} 메모리`,
        `${base} RAM`,
      ];
    default:
      return [base];
  }
}

/* ===================== 타이틀 스코어링 ===================== */
function scoreTitle(titleRaw, tokens, category) {
  const t = norm(titleRaw).toUpperCase();

  if (hasBlacklist(t)) return -999;

  let score = 0;

  // 토큰 커버리지
  for (const tok of tokens) {
    if (!tok) continue;
    if (t.includes(tok.toUpperCase())) {
      // 긴 토큰 가중치 ↑
      score += Math.max(2, Math.min(10, Math.floor(tok.length / 2)));
    } else {
      // 핵심 토큰(모델/시리즈/DDR 등)이 안 들어가면 감점
      if (/(RTX|GTX|RX|GEFORCE|RADEON|DDR|Z\d{3}|B\d{3}|H\d{3}|X\d{3}|AM5|AM4|LGA\d{3,4}|CORE|RYZEN)/.test(tok)) {
        score -= 2;
      }
    }
  }

  // 카테고리 힌트 단어 보너스/감점
  if (category === "gpu" && (/\b(GRAPHIC|GPU|그래픽|비디오카드|VGA)\b/i.test(t))) score += 2;
  if (category === "motherboard" && (/\b(BOARD|MAINBOARD|메인보드)\b/i.test(t))) score += 2;
  if (category === "memory" && (/\b(RAM|메모리|DIMM|SO[-\s]?DIMM)\b/i.test(t))) score += 2;
  if (category === "cpu" && (/\b(CPU|프로세서)\b/i.test(t))) score += 2;

  // 리뷰/기사/비교 단어 감점
  if (/\b(REVIEW|SPECS|PRICE|VERSUS|VS)\b/.test(t)) score -= 3;

  return score;
}

/* ===================== 네이버 쇼핑 호출 ===================== */
async function fetchNaverItems(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=30`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) {
    console.error(`❌ 네이버 API 실패: ${res.status} ${res.statusText}`);
    return [];
  }
  const json = await res.json();
  return json.items || [];
}

/* ============== 스마트 가격/이미지 추출 파이프라인 ============== */
async function fetchPriceImageSmart(name, category) {
  const variants = queryVariants(name, category);
  const tokens = tokensByCategory(name, category);
  const { min, max } = priceBoundsByCategory(category);

  console.log(`\n🔎 [${category}] 대상: ${name}`);
  console.log(`🧩 토큰: ${JSON.stringify(tokens)}`);

  const pool = []; // {title, price, image, score}
  for (const q of variants) {
    console.log(`   ▶ 검색: ${q}`);
    const items = await fetchNaverItems(q);

    for (const it of items) {
      const title = norm(it.title || "");
      const price = parseInt(it.lprice, 10);
      if (!title || isNaN(price)) continue;
      if (price < min || price > max) continue;

      const sc = scoreTitle(title, tokens, category);
      if (sc <= 0) continue; // 스코어 낮거나 블랙리스트

      pool.push({
        title,
        price,
        image: it.image || "",
        score: sc,
      });
    }
  }

  if (!pool.length) {
    console.log("⛔ 후보 없음 (스코어/가격 필터 후 0)");
    return null;
  }

  // 타이틀 중복 제거 (유사 타이틀 합치기) – 간단히 동일문자열 기준
  const byTitle = new Map();
  for (const c of pool) {
    if (!byTitle.has(c.title) || byTitle.get(c.title).score < c.score) {
      byTitle.set(c.title, c);
    }
  }
  const uniq = Array.from(byTitle.values());

  // 스코어 상위 50% 선별
  const sorted = uniq.sort((a,b)=>b.score - a.score);
  const top = sorted.slice(0, Math.max(3, Math.ceil(sorted.length/2)));

  // MAD로 아웃라이어 제거 → 중위가
  const prices = top.map(x=>x.price);
  const filtered = madFilter(prices, 3);
  const used = filtered.length >= 2 ? filtered : prices;
  const mid = median(used);

  // 이미지: 스코어 최상위 후보 우선
  const chosenImage = top[0]?.image || sorted[0]?.image || "";

  // 디버깅
  top.slice(0,8).forEach((c,i)=>{
    console.log(`📦 후보${i+1}: score=${c.score}, price=${c.price}, title="${c.title}"`);
  });
  console.log(`🧮 가격결정: mid=${mid}, 표본=${used.length}/${top.length} (전체=${uniq.length})`);

  if (!mid) return null;
  return { price: mid, image: chosenImage };
}

/* ============================ 라우터 ============================ */
router.post("/update-prices", async (req, res) => {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  const parts = await col.find({
    category: { $in: ["cpu", "gpu", "motherboard", "memory"] },
  }).toArray();

  console.log(`\n📦 총 ${parts.length}개의 부품 가격 업데이트 시작`);

  for (const part of parts) {
    try {
      const result = await fetchPriceImageSmart(part.name, part.category);
      if (!result) {
        console.log(`⛔ 실패: [${part.category}] ${part.name}`);
        continue;
      }
      const { price, image } = result;
      const already = (part.priceHistory || []).some(p => p.date === today);

      const ops = { $set: { price, image } };
      if (!already) ops.$push = { priceHistory: { date: today, price } };

      await col.updateOne({ _id: part._id }, ops);
      console.log(`✅ 완료: [${part.category}] ${part.name} → ${price}원`);
    } catch (e) {
      console.log(`❌ 예외: [${part.category}] ${part.name} | ${e.message}`);
    }
  }

  res.json({ message: "✅ 가격 업데이트 완료" });
});

export default router;
