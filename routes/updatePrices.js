// routes/updatePrices.js - 개선 버전 (정확도 대폭 향상)
import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

/* ========================= 블랙리스트 확장 ========================= */
const K_BLACKLIST_COMMON = [
  "중고","리퍼","리퍼비시","벌크","채굴","해시","마이닝","AS반품","전시","테스트","샘플",
  "리뷰","후기","스펙","사양","가격비교","쿠폰","보증연장","해외구매","직구","병행수입",
  "호환","호환성","테스트","교체","수리","튜닝","ARGB","LED","라이팅","RGB","조명",
  "키트","KIT","번들","묶음","세트","구성품","액세서리","부품","파츠",
  "매뉴얼","설명서","가이드","사은품","이벤트","프로모션"
];

const K_ACCESSORY_GPU = [
  "워터블록","워터 블록","워터블럭","워터 블럭","waterblock","water block",
  "수랭","워터","water","워터쿨","워터 쿨","쿨러","cooler","쿨링","cooling",
  "라디에이터","radiator","펌프","pump","리저버","reservoir",
  "백플레이트","backplate","브라켓","브래킷","bracket","holder","mount",
  "팬","fan","팬세트","팬 쿨러","방열판","히트싱크","heatsink","서멀","thermal","패드","pad",
  "라이저","riser","케이블","cable","어댑터","adapter","확장카드","extension",
  "스탠드","거치대","지지대","홀더","클램프"
];

// 🆕 카테고리별 필수 키워드 (하나라도 있어야 함)
const CATEGORY_MUST_INCLUDE = {
  cpu: ["CPU", "프로세서", "PROCESSOR"],
  gpu: ["그래픽카드", "VGA", "GPU", "비디오카드", "GRAPHICS"],
  memory: ["메모리", "RAM", "DDR"],
  motherboard: ["메인보드", "메보", "MOTHERBOARD", "M/B"],
  psu: ["파워", "파워서플라이", "PSU", "POWER"],
  case: ["케이스", "CASE", "PC케이스"],
  cooler: ["쿨러", "COOLER", "CPU쿨러", "히트파이프"],
  storage: ["SSD", "HDD", "저장장치", "하드", "스토리지"]
};

/* ========================= 유틸리티 ========================= */
function norm(s = "") {
  return s
    .replace(/[™®©]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNameTail(name="") {
  return norm(name)
    .replace(/(review[:\s].*|specs\s*(and|&)\s*price.*|price\s*(and|&)\s*specs.*|full\s*specs.*|features\s*and\s*specs.*)$/i, "")
    .trim();
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

/* ========================= 개선된 토큰 추출 ========================= */

// 🆕 CPU 토큰 추출 (브랜드, 시리즈, 모델)
function extractCpuTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 브랜드
  const brand = (n.match(/\b(AMD|INTEL)\b/) || [])[0];
  if (brand) tokens.push(brand);
  
  // 시리즈 (Ryzen, Core 등)
  const series = (n.match(/\b(RYZEN|CORE|THREADRIPPER|XEON)\b/) || [])[0];
  if (series) tokens.push(series);
  
  // 세대/등급 (5 7600X, i5-13400F 등)
  const model = (n.match(/\b(RYZEN\s*[357579]\s*\d{3,4}[XGTE]?|I[3579]-\d{4,5}[KFTS]?)\b/i) || [])[0];
  if (model) tokens.push(model.replace(/\s+/g, ""));
  
  // 소켓
  const socket = (n.match(/\b(AM4|AM5|LGA\s*1[27]00)\b/) || [])[0];
  if (socket) tokens.push(socket);
  
  return tokens;
}

// 🆕 메모리 토큰 추출 (타입, 속도, 용량)
function extractMemoryTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // DDR 타입
  const ddr = (n.match(/\bDDR[345]\b/) || [])[0];
  if (ddr) tokens.push(ddr);
  
  // 속도 (DDR5-5600, PC5-44800 등)
  const speed = (n.match(/\b(?:DDR[345]-)?(\d{4,5})\b/) || [])[1];
  if (speed) tokens.push(speed);
  
  // 용량 (32GB, 16GBx2 등)
  const capacity = (n.match(/\b(\d{1,3})\s*GB\b/) || [])[1];
  if (capacity) tokens.push(`${capacity}GB`);
  
  // CL (CL36, CL40 등)
  const cl = (n.match(/\bCL\s*(\d{2})\b/) || [])[1];
  if (cl) tokens.push(`CL${cl}`);
  
  return tokens;
}

// 🆕 메인보드 토큰 추출 (칩셋, 소켓, 폼팩터)
function extractMotherboardTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 브랜드
  const brand = (n.match(/\b(ASUS|MSI|GIGABYTE|ASROCK|BIOSTAR)\b/) || [])[0];
  if (brand) tokens.push(brand);
  
  // 칩셋 (B650, Z790, X670E 등)
  const chipset = (n.match(/\b([ABXZ]\d{3}[E]?|H\d{3})\b/) || [])[0];
  if (chipset) tokens.push(chipset);
  
  // 소켓
  const socket = (n.match(/\b(AM4|AM5|LGA\s*1[27]00)\b/) || [])[0];
  if (socket) tokens.push(socket);
  
  // 폼팩터
  const form = (n.match(/\b(ATX|M-ATX|MINI-ITX|E-ATX)\b/) || [])[0];
  if (form) tokens.push(form);
  
  return tokens;
}

// GPU 토큰 추출 (기존 유지, 약간 개선)
function extractGpuTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 브랜드
  const brand = (n.match(/\b(ASUS|MSI|GIGABYTE|GALAX|COLORFUL|INNO3D|ZOTAC|PNY|PALIT|SAPPHIRE|POWERCOLOR|XFX|ASROCK)\b/) || [])[0];
  if (brand) tokens.push(brand);
  
  // 시리즈
  const series = (n.match(/\b(GEFORCE|RADEON)\b/) || [])[0];
  if (series) tokens.push(series);
  
  // 모델 (RTX 4070 Ti, RX 7900 XT 등)
  const model = (n.match(/\b(RTX|GTX|RX)\s*-?\s*\d{3,4}\s*(TI|SUPER|XT|XTX)?\b/) || [])[0];
  if (model) tokens.push(model.replace(/\s+/g, " "));
  
  // VRAM
  const vram = (n.match(/\b(\d{1,3})\s*GB\b/) || [])[1];
  if (vram) tokens.push(`${vram}GB`);
  
  return tokens;
}

// 🆕 PSU 토큰 추출 (브랜드, 용량, 인증)
function extractPsuTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 브랜드
  const brand = (n.match(/\b(CORSAIR|SEASONIC|EVGA|THERMALTAKE|COOLER\s*MASTER|FSP|마이크로닉스|잘만)\b/i) || [])[0];
  if (brand) tokens.push(brand);
  
  // 용량 (750W, 850W 등)
  const watt = (n.match(/\b(\d{3,4})\s*W\b/) || [])[1];
  if (watt) tokens.push(`${watt}W`);
  
  // 80PLUS 인증 (Bronze, Gold, Platinum 등)
  const cert = (n.match(/\b(BRONZE|SILVER|GOLD|PLATINUM|TITANIUM)\b/) || [])[0];
  if (cert) tokens.push(cert);
  
  // 모듈러
  const modular = (n.match(/\b(FULL\s*MODULAR|SEMI\s*MODULAR)\b/i) || [])[0];
  if (modular) tokens.push(modular);
  
  return tokens;
}

// 🆕 케이스 토큰 추출 (브랜드, 크기, 폼팩터)
function extractCaseTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 브랜드
  const brand = (n.match(/\b(NZXT|LIAN\s*LI|CORSAIR|FRACTAL|PHANTEKS|COOLER\s*MASTER)\b/i) || [])[0];
  if (brand) tokens.push(brand);
  
  // 크기
  const size = (n.match(/\b(미들타워|빅타워|미니타워|슬림케이스|MINI\s*TOWER|MID\s*TOWER|FULL\s*TOWER)\b/i) || [])[0];
  if (size) tokens.push(size);
  
  // 폼팩터 지원
  const form = (n.match(/\b(ATX|M-ATX|MINI-ITX|E-ATX)\b/) || [])[0];
  if (form) tokens.push(form);
  
  return tokens;
}

// 🆕 쿨러 토큰 추출 (타입, 브랜드, 크기)
function extractCoolerTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 타입
  const type = (n.match(/\b(공냉|수냉|타워형|수직형|AIR|WATER|AIO)\b/i) || [])[0];
  if (type) tokens.push(type);
  
  // 브랜드
  const brand = (n.match(/\b(NOCTUA|BE\s*QUIET|COOLER\s*MASTER|DEEPCOOL|ARCTIC|NZXT|CORSAIR)\b/i) || [])[0];
  if (brand) tokens.push(brand);
  
  // 라디에이터 크기 (240mm, 360mm 등)
  const rad = (n.match(/\b(120|240|280|360|420)\s*MM\b/i) || [])[0];
  if (rad) tokens.push(rad);
  
  // 소켓 지원
  const socket = (n.match(/\b(AM4|AM5|LGA\s*1[27]00)\b/) || [])[0];
  if (socket) tokens.push(socket);
  
  return tokens;
}

// 🆕 스토리지 토큰 추출 (타입, 용량, 인터페이스)
function extractStorageTokens(name) {
  const n = cleanNameTail(name).toUpperCase();
  const tokens = [];
  
  // 타입
  const type = (n.match(/\b(SSD|HDD|NVME|SATA|M\.2)\b/) || [])[0];
  if (type) tokens.push(type);
  
  // 브랜드
  const brand = (n.match(/\b(SAMSUNG|CRUCIAL|WD|SEAGATE|KINGSTON|SK\s*HYNIX)\b/i) || [])[0];
  if (brand) tokens.push(brand);
  
  // 용량 (1TB, 2TB, 500GB 등)
  const capacity = (n.match(/\b(\d{1,4})\s*(TB|GB)\b/) || [])[0];
  if (capacity) tokens.push(capacity);
  
  // 폼팩터 (2.5", 3.5", M.2 2280 등)
  const form = (n.match(/\b(2\.5|3\.5|M\.2\s*\d{4})\b/) || [])[0];
  if (form) tokens.push(form);
  
  return tokens;
}

// 🆕 통합 토큰 추출 함수
function tokensByCategory(name, category) {
  switch (category) {
    case "cpu": return extractCpuTokens(name);
    case "gpu": return extractGpuTokens(name);
    case "memory": return extractMemoryTokens(name);
    case "motherboard": return extractMotherboardTokens(name);
    case "psu": return extractPsuTokens(name);
    case "case": return extractCaseTokens(name);
    case "cooler": return extractCoolerTokens(name);
    case "storage": return extractStorageTokens(name);
    default: return [];
  }
}

/* ========================= 개선된 쿼리 생성 ========================= */
// 🆕 핵심 키워드만 사용하여 검색 범위 확대
function generateSmartQueries(name, category, tokens) {
  const queries = [];
  
  // 1) 토큰 기반 쿼리 (핵심 키워드만)
  if (tokens.length >= 2) {
    queries.push(tokens.slice(0, 3).join(" "));  // 상위 3개 토큰
  }
  
  // 2) 카테고리 힌트 추가
  const categoryHints = {
    cpu: ["CPU", "프로세서"],
    gpu: ["그래픽카드", "GPU"],
    memory: ["메모리", "RAM"],
    motherboard: ["메인보드"],
    psu: ["파워서플라이"],
    case: ["PC케이스"],
    cooler: ["CPU쿨러"],
    storage: ["SSD"]
  };
  
  const hint = categoryHints[category]?.[0] || "";
  if (tokens.length >= 1 && hint) {
    queries.push(`${tokens[0]} ${hint}`);
  }
  
  // 3) 원본 이름 (폴백)
  const cleaned = cleanNameTail(name);
  if (cleaned.length < 50) {  // 너무 길면 제외
    queries.push(cleaned);
  }
  
  // 4) 브랜드 + 모델 조합
  if (tokens.length >= 2) {
    queries.push(`${tokens[0]} ${tokens[1]}`);
  }
  
  return [...new Set(queries)].slice(0, 5);  // 최대 5개, 중복 제거
}

/* ========================= 가격 범위 ========================= */
function priceBoundsByCategory(category) {
  switch (category) {
    case "gpu":         return { min: 60000,  max: 6000000 };
    case "cpu":         return { min: 30000,  max: 3000000 };
    case "motherboard": return { min: 25000,  max: 1800000 };
    case "memory":      return { min: 10000,  max: 1500000 };
    case "psu":         return { min: 20000,  max: 500000 };
    case "case":        return { min: 20000,  max: 500000 };
    case "cooler":      return { min: 10000,  max: 300000 };
    case "storage":     return { min: 30000,  max: 2000000 };
    default:            return { min: 10000,  max: 3000000 };
  }
}

/* ========================= 네이버 API (개선) ========================= */
// 🆕 여러 페이지 수집 (최대 100개)
async function fetchNaverItemsMultiPage(query, maxResults = 100) {
  const allItems = [];
  const perPage = 100;  // 최대값
  
  try {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${perPage}`;
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });
    
    if (!res.ok) {
      console.error(`❌ 네이버 API 실패: ${res.status}`);
      return [];
    }
    
    const json = await res.json();
    const items = (json.items || []).map(it => ({
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
    
    allItems.push(...items);
    
  } catch (err) {
    console.error(`❌ 네이버 API 오류: ${err.message}`);
  }
  
  return allItems.slice(0, maxResults);
}

/* ========================= 개선된 스코어링 ========================= */
// 🆕 범용 스코어링 함수 (모든 카테고리 지원)
function scoreTitle(title, tokens, category, originalName) {
  const t = norm(title);
  const up = t.toUpperCase();
  let score = 0;
  
  // 1) 블랙리스트 즉시 제외
  if (containsAny(t, K_BLACKLIST_COMMON)) return -999;
  
  // 2) GPU 액세서리 제외
  if (category === "gpu" && containsAny(t, K_ACCESSORY_GPU)) return -999;
  
  // 3) 카테고리 필수 키워드 체크
  const mustInclude = CATEGORY_MUST_INCLUDE[category] || [];
  const hasCategoryKeyword = mustInclude.some(kw => up.includes(kw.toUpperCase()));
  if (!hasCategoryKeyword) return -50;  // 카테고리 키워드 없으면 낮은 점수
  
  // 4) 토큰 매칭 점수
  for (const tok of tokens) {
    if (!tok) continue;
    const tokUp = tok.toUpperCase();
    if (up.includes(tokUp)) {
      // 토큰 길이에 비례하여 가중치 (2~15점)
      const weight = Math.max(2, Math.min(15, Math.floor(tok.length / 2)));
      score += weight;
      
      // 정확히 일치하면 보너스
      const exactMatch = new RegExp(`\\b${tokUp}\\b`).test(up);
      if (exactMatch) score += 5;
    }
  }
  
  // 5) 원본 이름과의 유사도 (선택적)
  const nameTokens = cleanNameTail(originalName).toUpperCase().split(/\s+/);
  const titleTokens = up.split(/\s+/);
  const commonTokens = nameTokens.filter(nt => titleTokens.some(tt => tt.includes(nt) || nt.includes(tt)));
  score += commonTokens.length * 2;
  
  // 6) 부정 키워드 감점
  if (/\b(REVIEW|VERSUS|VS|비교|추천|순위)\b/i.test(t)) score -= 10;
  
  // 7) 정품/공식/신품 키워드 가산점
  if (/\b(정품|공식|신품|새제품)\b/i.test(t)) score += 3;
  
  return score;
}

/* ========================= 메인 가격 추출 함수 ========================= */
async function fetchPriceImageSmart(name, category) {
  const tokens = tokensByCategory(name, category);
  const queries = generateSmartQueries(name, category, tokens);
  const { min, max } = priceBoundsByCategory(category);
  
  console.log(`\n🔎 [${category}] 대상: ${name}`);
  console.log(`   🧩 토큰: ${JSON.stringify(tokens)}`);
  console.log(`   📝 쿼리: ${JSON.stringify(queries)}`);
  
  const pool = [];
  
  for (const q of queries) {
    console.log(`   ▶ 검색: "${q}"`);
    const items = await fetchNaverItemsMultiPage(q, 100);  // 🆕 최대 100개
    console.log(`   📦 결과: ${items.length}개`);
    
    for (const it of items) {
      const title = norm(it.title);
      const price = parseInt(it.lprice, 10);
      
      if (!title || isNaN(price)) continue;
      if (price < min || price > max) continue;
      
      const sc = scoreTitle(title, tokens, category, name);
      if (sc <= 0) continue;
      
      pool.push({ title, price, image: it.image, score: sc });
    }
  }
  
  if (!pool.length) {
    console.log("   ⛔ 후보 없음 (필터 후 0개)");
    return null;
  }
  
  // 타이틀 중복 제거 (최고 점수만 유지)
  const byTitle = new Map();
  for (const c of pool) {
    if (!byTitle.has(c.title) || byTitle.get(c.title).score < c.score) {
      byTitle.set(c.title, c);
    }
  }
  const uniq = Array.from(byTitle.values());
  
  // 스코어 상위 70% (더 많은 샘플 확보)
  const sorted = uniq.sort((a,b) => b.score - a.score);
  const topCount = Math.max(5, Math.ceil(sorted.length * 0.7));  // 🆕 70%
  const top = sorted.slice(0, topCount);
  
  // MAD 필터로 이상치 제거
  const prices = top.map(x => x.price);
  const filtered = madFilter(prices, 3);
  const used = filtered.length >= 3 ? filtered : prices;  // 🆕 최소 3개
  const mid = median(used);
  const chosenImage = top[0]?.image || sorted[0]?.image || "";
  
  // 디버깅 로그
  console.log(`   📊 후보 분석:`);
  top.slice(0, 10).forEach((c, i) => {
    console.log(`      ${i+1}. score=${c.score}, price=${c.price.toLocaleString()}원 - "${c.title.substring(0, 60)}..."`);
  });
  console.log(`   🧮 가격 결정: ${mid?.toLocaleString()}원 (샘플: ${used.length}/${top.length}, 전체: ${uniq.length})`);
  
  if (!mid) return null;
  return { price: mid, image: chosenImage };
}

/* ========================= 라우터 ========================= */
router.post("/update-prices", async (req, res) => {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);
  
  const parts = await col.find({
    category: { 
      $in: ["cpu", "gpu", "motherboard", "memory", "psu", "case", "cooler", "storage"]
    },
  }).toArray();
  
  console.log(`\n📦 총 ${parts.length}개 부품 가격 업데이트 시작`);
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
