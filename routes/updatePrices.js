// routes/updatePrices.js
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

/* -------------------------- 공통 유틸 -------------------------- */
const K_BLACKLIST = [
  "중고", "리퍼", "리퍼비시", "벌크", "채굴", "해시", "마이닝",
  "리뷰", "후기", "스펙", "사양", "가격", "가격비교", "쿠폰",
  "호환", "호환성", "케이블", "연장", "어댑터", "라이저", "브라켓", "백플레이트",
  "테스트", "교체", "수리", "서멀", "서멀구리스", "팬교체", "튜닝", "LED", "ARGB",
];

function hasBlacklist(title) {
  return K_BLACKLIST.some(w => title.toLowerCase().includes(w.toLowerCase()));
}

function normalize(str = "") {
  return str
    .replace(/[™®]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .trim();
}

function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.floor((a[mid - 1] + a[mid]) / 2);
}

/* --------------------- 카테고리별 토큰/쿼리 --------------------- */

function extractGpuTokens(name) {
  const n = normalize(name);
  // 예: "ASUS TUF GeForce RTX 4070 SUPER 12GB OC"
  const tokens = [];
  // 제조사/브랜드 토큰 (느슨하게)
  const brand = (n.match(/\b(ASUS|MSI|GIGABYTE|GALAX|COLORFUL|INNO3D|ZOTAC|PNY|PALIT|SAPPHIRE|POWER ?COLOR|XFX|ASROCK)\b/i) || [])[0];
  if (brand) tokens.push(brand.toUpperCase());

  // 라인업
  const series = (n.match(/\b(GEFORCE|RADEON)\b/i) || [])[0];
  if (series) tokens.push(series.toUpperCase());

  // 모델 넘버/서픽스
  const model = (n.match(/\b(RTX|GTX|RX)\s*-?\s*\d{3,4}\s*(TI|SUPER|XT|XTX)?\b/i) || [])[0];
  if (model) tokens.push(model.replace(/\s+/g, " ").toUpperCase());

  // VRAM
  const vram = (n.match(/\b(\d{1,3})\s*GB\b/i) || [])[1];
  if (vram) tokens.push(`${vram}GB`);

  return tokens;
}

function extractCpuTokens(name) {
  const n = normalize(name);
  // 예: "Ryzen 7 7800X3D" / "Core i5-14400F"
  const tokens = [];
  const amd = (n.match(/\b(RYZEN\s*[3579]|RYZEN\s?THREADRIPPER|ATHLON)\b/i) || [])[0];
  const intel = (n.match(/\b(CORE\s*i[3579]|PENTIUM|CELERON)\b/i) || [])[0];
  const gen = (n.match(/\b\d{3,5}(?:X3D|F|K|KF|KS)?\b/i) || [])[0];

  if (amd) tokens.push(amd.toUpperCase());
  if (intel) tokens.push(intel.toUpperCase());
  if (gen) tokens.push(gen.toUpperCase());

  return tokens;
}

function extractBoardTokens(name) {
  const n = normalize(name);
  // 예: "MSI MAG B760M Mortar WiFi"
  const tokens = [];
  const brand = (n.match(/\b(ASUS|MSI|GIGABYTE|ASROCK|BIOSTAR)\b/i) || [])[0];
  const chipset = (n.match(/\b(Z\d{3}|B\d{3}|H\d{3}|X\d{3}|A\d{3}|B[\d]{3}M|H[\d]{3}M|Z[\d]{3}M)\b/i) || [])[0];
  const socket = (n.match(/\b(AM4|AM5|LGA\s?\d{3,4})\b/i) || [])[0];

  if (brand) tokens.push(brand.toUpperCase());
  if (chipset) tokens.push(chipset.replace(/\s+/g, "").toUpperCase());
  if (socket) tokens.push(socket.replace(/\s+/g, "").toUpperCase());

  return tokens;
}

function extractMemoryTokens(name) {
  const n = normalize(name);
  // 예: "G.SKILL Trident Z5 RGB DDR5-6400 32GB (2x16GB) CL32"
  const tokens = [];
  const brand = (n.match(/\b(G\.?SKILL|GSKILL|CORSAIR|KINGSTON|ADATA|TEAMGROUP|CRUCIAL|PATRIOT|SAMSUNG|MICRON)\b/i) || [])[0];
  const ddr = (n.match(/\b(DDR[2-5])\b/i) || [])[0];
  const speed = (n.match(/\b(\d{4,5})\s*(MHZ|MT\/S)?\b/i) || [])[1];
  const kit = (n.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\s*GB\b/i) || []);
  const capacity = (n.match(/\b(\d{1,3})\s*GB\b/i) || [])[1];
  const cl = (n.match(/\b(CL\s*\d{1,2})\b/i) || [])[1];

  if (brand) tokens.push(brand.replace(/\./g, "").toUpperCase());
  if (ddr) tokens.push(ddr.toUpperCase());
  if (speed) tokens.push(`${speed}`);
  if (kit.length) tokens.push(`${kit[1]}X${kit[2]}GB`);
  else if (capacity) tokens.push(`${capacity}GB`);
  if (cl) tokens.push(cl.replace(/\s+/g, "").toUpperCase());

  return tokens;
}

function makeQuery(name, category) {
  const base = normalize(name);
  switch (category) {
    case "gpu":
      return `${base} 그래픽카드`;
    case "cpu":
      return `${base} CPU`;
    case "motherboard":
      return `${base} 메인보드`;
    case "memory":
      return `${base} 메모리 RAM`;
    default:
      return base;
  }
}

function tokensByCategory(name, category) {
  switch (category) {
    case "gpu": return extractGpuTokens(name);
    case "cpu": return extractCpuTokens(name);
    case "motherboard": return extractBoardTokens(name);
    case "memory": return extractMemoryTokens(name);
    default: return [];
  }
}

/* ---------------------- 스코어링 & 필터링 ---------------------- */

function scoreTitle(title, tokens) {
  const t = normalize(title).toUpperCase();
  if (hasBlacklist(t)) return -999; // 바로 제외

  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    const ok = t.includes(tok.toUpperCase());
    if (ok) score += Math.max(2, Math.min(8, Math.floor(tok.length / 2)));
  }

  // 강한 패턴 보너스
  if (/\b(NON-?LHR|OC|GAMING|TUF|STRIX|VENTUS|EAGLE|TRINITY|HALL OF FAME|HOF)\b/i.test(t)) {
    score += 1; // 모델 하위브랜드가 들어가면 약간 가산(너무 크지는 않게)
  }

  // 리뷰/기사/가이드 가능성 낮추기
  if (/REVIEW|SPECS|PRICE|VERSUS|VS/.test(t)) score -= 3;

  return score;
}

function priceBoundsByCategory(category) {
  switch (category) {
    case "gpu":         return { min: 50000, max: 5000000 };
    case "cpu":         return { min: 30000, max: 3000000 };
    case "motherboard": return { min: 20000, max: 1500000 };
    case "memory":      return { min: 10000, max: 1200000 };
    default:            return { min: 10000, max: 3000000 };
  }
}

/* --------------------- 네이버 쇼핑 호출 --------------------- */
async function fetchNaverItems(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
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

/* ------------------ 카테고리 인식형 가격/이미지 ------------------ */
async function fetchPriceImageSmart(name, category) {
  const query = makeQuery(name, category);
  const tokens = tokensByCategory(name, category);
  const { min, max } = priceBoundsByCategory(category);

  console.log(`🔎 [${category}] 검색어: ${query}`);
  console.log(`🧩 토큰: ${JSON.stringify(tokens)}`);

  const items = await fetchNaverItems(query);
  if (!items.length) {
    console.log("⛔ 네이버 검색 결과 없음");
    return null;
  }

  // 스코어 부여 + 가격 필터
  const scored = [];
  for (const it of items) {
    const title = it.title?.replace(/<[^>]+>/g, "") || "";
    const price = parseInt(it.lprice, 10);
    if (isNaN(price) || price < min || price > max) {
      console.log(`⏭️ 가격 범위 제외: ${title} (${price})`);
      continue;
    }
    const s = scoreTitle(title, tokens);
    if (s <= 0) {
      console.log(`⏭️ 스코어 낮음/블랙리스트: ${title} (score=${s})`);
      continue;
    }
    scored.push({ title, price, image: it.image || "", score: s });
  }

  // 디버깅 출력
  scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .forEach((c, i) => console.log(`📦 후보${i + 1}: score=${c.score}, price=${c.price}, ${c.title}`));

  if (!scored.length) {
    console.log("⛔ 매칭 후보 없음 (스코어/가격 필터 후 0)");
    return null;
  }

  // 상위 스코어 절반의 가격만 대상으로 중위가 계산
  const top = scored.sort((a, b) => b.score - a.score);
  const cutoff = Math.max(3, Math.ceil(top.length / 2));
  const consider = top.slice(0, cutoff);
  const mid = median(consider.map(x => x.price));
  const chosenImage = consider[0].image || top[0].image || "";

  return { price: mid, image: chosenImage };
}

/* ---------------------- 라우터: 가격 업데이트 ---------------------- */
router.post("/update-prices", async (req, res) => {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  // 필요한 카테고리만
  const parts = await col.find({
    category: { $in: ["cpu", "gpu", "motherboard", "memory"] },
  }).toArray();

  console.log(`📦 총 ${parts.length}개의 부품 가격 업데이트 시작`);

  for (const part of parts) {
    try {
      const result = await fetchPriceImageSmart(part.name, part.category);
      if (!result) {
        console.log(`⛔ 가격 가져오기 실패: ${part.category} | ${part.name}`);
        continue;
      }

      const { price, image } = result;
      const priceEntry = { date: today, price };
      const already = (part.priceHistory || []).some(p => p.date === today);

      const updateOps = { $set: { price, image } };
      if (!already) updateOps.$push = { priceHistory: priceEntry };

      await col.updateOne({ _id: part._id }, updateOps);
      console.log(`✅ 업데이트 완료: [${part.category}] ${part.name} → ${price}원`);
    } catch (e) {
      console.log(`❌ 처리 실패: [${part.category}] ${part.name} | ${e.message}`);
    }
  }

  res.json({ message: "✅ 가격 업데이트 완료" });
});

export default router;
