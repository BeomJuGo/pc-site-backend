// routes/updatePrices.js - 8개 카테고리 지원 (CPU, GPU, Motherboard, Memory, PSU, Case, Cooler, Storage)
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

/* ========================= 공통 유틸 ========================= */
const K_ACCESSORY_GPU = [
  // 워터블록/쿨링/라디에이터/브래킷/백플레이트/팬 등
  "워터블록","워터 블록","워터블럭","워터 블럭","waterblock","water block","waterblock",
  "수랭","워터","water","워터쿨","워터 쿨","쿨러","cooler","쿨링","cooling",
  "라디에이터","radiator","펌프","pump","리저버","reservoir",
  "백플레이트","backplate","브라켓","브래킷","bracket","holder","mount",
  "팬","fan","팬세트","팬 쿨러","방열판","히트싱크","heatsink","서멀","thermal","패드","pad",
  "라이저","riser","케이블","cable","어댑터","adapter","확장카드","extension",
];

const K_BLACKLIST_COMMON = [
  "중고","리퍼","리퍼비시","벌크","채굴","해시","마이닝",
  "리뷰","후기","스펙","사양","가격비교","쿠폰","보증연장",
  "호환","호환성","테스트","교체","수리","튜닝","ARGB","LED","라이팅",
];

const GPU_CATEGORY_HINTS = ["그래픽카드", "비디오카드", "VGA", "GPU"];
const GPU_TITLE_MUST = /(RTX|GTX|RX)\b/i;

function norm(s = "") {
  return s
    .replace(/[™®]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNameTail(name="") {
  return norm(name).replace(/(review[:\s].*|specs\s*(and|&)\s*price.*|price\s*(and|&)\s*specs.*|full\s*specs.*|features\s*and\s*specs.*)$/i, "").trim();
}

function containsAny(s="", list=[]) {
  const t = s.toLowerCase();
  return list.some(w => t.includes(w.toLowerCase()));
}

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : Math.floor((a[m-1]+a[m])/2);
}

function madFilter(prices, k = 3) {
  if (prices.length < 4) return prices;
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
    case "psu":         return { min: 20000,  max: 500000 };   // 🆕 PSU
    case "case":        return { min: 20000,  max: 500000 };   // 🆕 케이스
    case "cooler":      return { min: 10000,  max: 300000 };   // 🆕 쿨러
    case "storage":     return { min: 30000,  max: 2000000 };  // 🆕 스토리지
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

function tokensByCategory(name, category) {
  if (category === "gpu") return extractGpuTokens(name);
  return [];
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
      return [`${base} CPU`, `${base} 정품`];
    case "motherboard":
      return [`${base} 메인보드`, `${base} 메보`];
    case "memory":
      return [`${base} 메모리`, `${base} RAM`];
    case "psu":
      return [`${base} 파워`, `${base} 파워서플라이`, `${base} PSU`]; // 🆕
    case "case":
      return [`${base} 케이스`, `${base} PC케이스`]; // 🆕
    case "cooler":
      return [`${base} 쿨러`, `${base} CPU쿨러`]; // 🆕
    case "storage":
      return [`${base} SSD`, `${base} 저장장치`]; // 🆕
    default:
      return [base];
  }
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
  return (json.items || []).map(it => ({
    title: it.title || "",
    image: it.image || "",
    lprice: it.lprice,
    brand: it.brand || "",
    maker: it.maker || "",
    category1: it.category1 || "",
    category2: it.category2 || "",
    category3: it.category3 || "",
    category4: it.category4 || "",
  }));
}

/* ============== GPU 본품/액세서리 판별 & 스코어링 ============== */
function isNaverGpuCategory(item) {
  const cats = [item.category1, item.category2, item.category3, item.category4].map(norm);
  return cats.some(c =>
    GPU_CATEGORY_HINTS.some(h => c.toLowerCase().includes(h.toLowerCase()))
  );
}

function isGpuAccessoryTitle(title) {
  const t = norm(title).toLowerCase();
  return K_ACCESSORY_GPU.some(w => t.includes(w.toLowerCase()));
}

function scoreGpuTitle(title, tokens) {
  const t = norm(title);
  const up = t.toUpperCase();

  // 액세서리/블랙리스트 즉시 제외
  if (isGpuAccessoryTitle(t)) return -999;
  if (containsAny(t, K_BLACKLIST_COMMON)) return -999;

  // 반드시 포함해야 할 기본 패턴: RTX/GTX/RX 중 하나
  if (!GPU_TITLE_MUST.test(up)) return -50;

  // VRAM(XXGB)와 GDDR(또는 GDDR7/6) 힌트 중 하나라도 들어 있으면 가산
  let score = 0;
  if (/\b\d{1,3}\s*GB\b/i.test(t)) score += 4;
  if (/\bGDDR\s*\d\b/i.test(t) || /\bGDDR[567]\b/i.test(t)) score += 3;
  if (/\bPCI[-\s]?E\b/i.test(t)) score += 1;

  // 토큰 매칭 가중치
  for (const tok of tokens) {
    if (!tok) continue;
    if (up.includes(tok.toUpperCase())) {
      score += Math.max(2, Math.min(10, Math.floor(tok.length / 2)));
    }
  }

  // 리뷰/기사/비교 감점(이중 안전장치)
  if (/\b(REVIEW|SPECS|PRICE|VERSUS|VS)\b/i.test(up)) score -= 3;

  return score;
}

/* ============== 스마트 가격/이미지 추출 파이프라인 ============== */
async function fetchPriceImageSmart(name, category) {
  const variants = queryVariants(name, category);
  const tokens = tokensByCategory(name, category);
  const { min, max } = priceBoundsByCategory(category);

  console.log(`\n🔎 [${category}] 대상: ${name}`);
  if (category === "gpu") console.log(`🧩 GPU 토큰: ${JSON.stringify(tokens)}`);

  const pool = []; // {title, price, image, score}

  for (const q of variants) {
    console.log(`   ▶ 검색: ${q}`);
    const items = await fetchNaverItems(q);

    for (const it of items) {
      const title = norm(it.title);
      const price = parseInt(it.lprice, 10);
      if (!title || isNaN(price)) continue;
      if (price < min || price > max) continue;

      // 카테고리/액세서리 필터 (GPU 전용 강화)
      if (category === "gpu") {
        // 1) 네이버 카테고리가 GPU 계열이 아닐 경우 PASS
        const catOk = isNaverGpuCategory(it) || /그래픽\s*카드|GPU|비디오\s*카드|VGA/i.test(title);
        if (!catOk) continue;
        
        // 2) 액세서리 키워드가 하나라도 등장하면 제외
        if (isGpuAccessoryTitle(title)) continue;
        
        // 3) 본품 특징 점수화
        const sc = scoreGpuTitle(title, tokens);
        if (sc <= 0) continue;
        
        pool.push({ title, price, image: it.image, score: sc });
      } else {
        // 기존 카테고리 로직(간단 스코어)
        let sc = 1;
        if (containsAny(title, K_BLACKLIST_COMMON)) sc = -999;
        if (sc > 0) pool.push({ title, price, image: it.image, score: sc });
      }
    }
  }

  if (!pool.length) {
    console.log("⛔ 후보 없음 (필터 후 0)");
    return null;
  }

  // 타이틀 중복 제거
  const byTitle = new Map();
  for (const c of pool) {
    if (!byTitle.has(c.title) || byTitle.get(c.title).score < c.score) {
      byTitle.set(c.title, c);
    }
  }
  const uniq = Array.from(byTitle.values());

  // 스코어 상위 50%
  const sorted = uniq.sort((a,b)=>b.score - a.score);
  const top = sorted.slice(0, Math.max(3, Math.ceil(sorted.length/2)));

  // MAD 아웃라이어 제거 후 중위가
  const prices = top.map(x=>x.price);
  const filtered = madFilter(prices, 3);
  const used = filtered.length >= 2 ? filtered : prices;
  const mid = median(used);
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

  // 🆕 8개 카테고리 모두 포함
  const parts = await col.find({
    category: { 
      $in: [
        "cpu", "gpu", "motherboard", "memory",      // 기존 4개
        "psu", "case", "cooler", "storage"          // 신규 4개
      ] 
    },
  }).toArray();

  console.log(`\n📦 총 ${parts.length}개의 부품 가격 업데이트 시작`);
  console.log(`📋 카테고리: CPU, GPU, Motherboard, Memory, PSU, Case, Cooler, Storage\n`);

  let successCount = 0;
  let failCount = 0;

  for (const part of parts) {
    try {
      const result = await fetchPriceImageSmart(part.name, part.category);
      if (!result) {
        console.log(`⛔ 실패: [${part.category}] ${part.name}`);
        failCount++;
        continue;
      }
      const { price, image } = result;
      const already = (part.priceHistory || []).some(p => p.date === today);

      const ops = { $set: { price, image } };
      if (!already) ops.$push = { priceHistory: { date: today, price } };

      await col.updateOne({ _id: part._id }, ops);
      console.log(`✅ 완료: [${part.category}] ${part.name} → ${price.toLocaleString()}원`);
      successCount++;
    } catch (e) {
      console.log(`❌ 예외: [${part.category}] ${part.name} | ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n📊 가격 업데이트 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
  res.json({ 
    message: "✅ 가격 업데이트 완료",
    total: parts.length,
    success: successCount,
    fail: failCount
  });
});

export default router;
