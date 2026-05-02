// routes/recommend.js
import express from "express";
import { getDB } from "../db.js";
import config from "../config.js";
import { loadParts, extractBoardFormFactor, isCaseCompatible } from "../utils/recommend-helpers.js";
import { getPopularityScore } from "../utils/naverDatalab.js";
import logger from "../utils/logger.js";
import { validate } from "../middleware/validate.js";
import { recommendV2Schema } from "../schemas/recommend.js";
import { getCache, setCache } from "../utils/responseCache.js";

const OPENAI_API_KEY = config.openaiApiKey;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const router = express.Router();

const buildingInProgressV2 = new Set();

const BUDGET_SET_SYSTEM_PROMPT = `당신은 PC 견적 전문가입니다.
주어진 부품 목록(실제 DB 데이터)에서만 선택하여 예산과 용도에 최적화된 호환 가능한 PC 견적을 작성하세요.
반드시 JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.

GPU는 선택 사항입니다:
- 예산이 충분하면 GPU를 포함하세요.
- 예산이 부족하거나 GPU를 추가하면 총 가격이 초과될 경우, 내장 그래픽이 탑재된 CPU(AMD 라이젠 G시리즈, 인텔 내장그래픽 CPU 등)를 선택하고 GPU는 제외하세요.
- GPU 없이 구성할 때 출력 형식의 gpu 필드는 생략합니다.

출력 형식: {"parts":{"cpu":{"name":"...","price":숫자},"gpu":{"name":"...","price":숫자},"motherboard":{"name":"...","price":숫자},"memory":{"name":"...","price":숫자},"psu":{"name":"...","price":숫자},"cooler":{"name":"...","price":숫자},"storage":{"name":"...","price":숫자},"case":{"name":"...","price":숫자}},"totalPrice":숫자,"summary":"한줄설명"}
(gpu 필드는 예산 초과 시 생략 가능)

호환성 규칙:
- CPU 소켓과 메인보드 소켓 일치
- 메모리 DDR 규격 일치
- PSU 출력 = CPU TDP + GPU TDP + 100W 이상 (GPU 없으면 CPU TDP + 100W)
- 쿨러 소켓 CPU와 일치
- 케이스 폼팩터 메인보드와 일치

예산 규칙 (절대 준수):
- 총 가격은 예산의 90~110% 범위여야 함
- 총 가격이 예산의 90% 미만이면 오답 — 더 고사양 부품으로 교체할 것
- 총 가격이 예산의 110% 초과도 오답 — 더 저렴한 부품으로 교체하거나 GPU를 제외할 것`;

/* ==================== util ==================== */

function normalizeSocket(socket) {
  if (!socket) return "";
  const s = socket.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (/LGA115[0-1X]/.test(s)) return "LGA115X";
  return s;
}

function extractCpuSocket(cpu) {
  const text = `${cpu.name || ""} ${cpu.info || ""} ${cpu.specSummary || ""}`;
  const combined = text.toUpperCase();
  let m = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (m) return normalizeSocket(m[1]);
  if (/인텔|INTEL/i.test(text)) {
    if (/ARROW.?LAKE|시리즈\s*2|SERIES\s*2|ULTRA\s*[579]\s*2\d{2}|LGA\s*1851/i.test(combined)) return "LGA1851";
    if (/14세대|13세대|12세대|\b(14|13|12)\s*GEN|낙터레이크|RAPTOR|앨더레이크|ALDER/i.test(combined)) return "LGA1700";
    if (/11세대|10세대|\b(11|10)\s*GEN|로켓레이크|ROCKET|코멧레이크|COMET/i.test(combined)) return "LGA1200";
    if (/9세대|8세대|\b(9|8)\s*GEN|커피레이크|COFFEE/i.test(combined)) return "LGA1151";
    const mm = combined.match(/\b(1[0-4]\d{3}[A-Z]*)\b/);
    if (mm) {
      const n = parseInt(mm[1].substring(0, 2));
      if (n >= 12 && n <= 14) return "LGA1700";
      if (n >= 10 && n <= 11) return "LGA1200";
      if (n >= 6 && n <= 9) return "LGA1151";
    }
  }
  return "";
}

function extractBoardSocket(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`;
  const combined = text.toUpperCase();
  let m = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (m) return normalizeSocket(m[1]);
  if (/B850|X870|A850|B850E|X870E|AM5|B650|X670|A620|B650E|X670E/i.test(combined)) return "AM5";
  if (/AM4|B550|X570|A520|B450|X470|B350|X370/i.test(combined)) return "AM4";
  if (/Z890|B860|H870|LGA\s?1851/i.test(combined)) return "LGA1851";
  if (/Z790|B760|H770|Z690|B660|H610|H670|LGA\s?1700/i.test(combined)) return "LGA1700";
  if (/Z590|B560|H570|Z490|B460|H410|LGA\s?1200/i.test(combined)) return "LGA1200";
  if (/Z390|B360|H370|Z370|B250|H270|Z270|B150|H170|Z170|LGA\s?1151/i.test(combined)) return "LGA1151";
  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `LGA${lga[1]}`;
  return "";
}

function isSocketCompatible(a, b) {
  if (!a || !b) return false;
  return normalizeSocket(a) === normalizeSocket(b);
}

function extractDdrType(text = "") {
  const m = text.toUpperCase().match(/DDR([12345])/);
  return m ? `DDR${m[1]}` : "";
}

function extractMemorySpeed(text = "") {
  for (const pat of [/(\d{4,5})\s*MHz/i, /DDR[45][-\s]?(\d{4,5})/i, /(\d{4,5})\s*MT\/S/i]) {
    const m = text.match(pat);
    if (m) { const s = parseInt(m[1]); if (s >= 1600 && s <= 10000) return s; }
  }
  return 0;
}

function extractBoardMemorySpeedRange(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`.toUpperCase();
  const sock = extractBoardSocket(board);
  const ddr = extractDdrType(text);
  if (ddr === "DDR5") {
    if (sock === "AM5") return { min: 4800, max: 7200 };
    if (sock === "LGA1851") return { min: 5600, max: 8000 };
    return { min: 4800, max: 8000 };
  }
  if (ddr === "DDR4") {
    if (sock === "AM4") return { min: 2133, max: 5200 };
    return { min: 2133, max: 4800 };
  }
  return { min: 0, max: 10000 };
}

function isMemoryCompatible(memory, board) {
  const mDdr = extractDdrType(memory.name || memory.info || "");
  if (["DDR1", "DDR2", "DDR3"].includes(mDdr)) return false;
  const bDdr = extractDdrType(board.info || board.specSummary || "");
  if (bDdr && mDdr && bDdr !== mDdr) return false;
  const spd = extractMemorySpeed(memory.name || memory.info || "");
  if (spd > 0) {
    const r = extractBoardMemorySpeedRange(board);
    if (spd < r.min || spd > r.max) return false;
  }
  return true;
}

const getCpuScore = (cpu) => cpu.benchmarkScore?.passmarkscore || cpu.benchScore || 0;
const getGpuScore = (gpu) => gpu.benchmarkScore?.["3dmarkscore"] || gpu.benchScore || 0;

/* ==================== V2: 보조부품 인기순 자동선정 + AI CPU/GPU 최적화 ==================== */

const BUDGET_SET_V2_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// purpose별 CPU 조합 예산 비율 (remaining 기준)
// gaming 0.50: X3D CPU(7500X3D 350K, 9800X3D 570K)이 1.5M+ 예산에서 선택될 수 있도록 상향
const CPU_RATIO_BY_PURPOSE = { gaming: 0.50, work: 0.55 };
// purpose별 GPU 절대 상한 비율 (총 예산 기준, null = 제한 없음)
const GPU_RATIO_BY_PURPOSE = { gaming: null, work: 0.35 };

// X3D CPU 판별 (게이밍은 우선, 작업용은 배제)
const isX3dCpu = (cpu) => /X3D/i.test(cpu?.name || '');

// Intel K/KF/KS 시리즈 판별 (게이밍 인텔에서 우선, 평행하게 X3D와 동일 역할)
const isIntelKSeries = (cpu) => {
  const n = cpu?.name || '';
  // 13600KF, 14600KF, 250K, 270K, 14900KS 등 끝자리가 K, KF, KS
  return /(?:코어|core|코어 ?울트라|울트라|i\d|\d{2,3})[^\s]*\s?\d{3,4}\s?(?:K|KF|KS)\b/i.test(n)
    || /\b\d{3,4}\s?(?:K|KF|KS|K\s?Plus)\b/i.test(n);
};

// 32GB 메모리 판별 (16GB×2, 32GB(1×) 모두 인식)
const is32GbMemory = (m) => /32GB|16GB[^\d]{0,5}(?:[x×*]|2ea|2개)|2[^\d]{0,3}16GB|16G[^\d]{0,3}2/i.test(m?.name || '');

// CPU 점수 최소값 (예산 tier별 구식 CPU 배제)
// passmark 기준: 5600 ≈ 22000, 5500GT ≈ 17000, 12100F ≈ 14000, 1700 ≈ 14761
const minCpuScoreByBudget = (b) => {
  if (b >= 1800000) return 25000;  // 9600X / 13600KF 이상
  if (b >= 1500000) return 22000;  // 7500X3D / 5600X 이상
  if (b >= 1200000) return 18000;  // 12400F / 7500F 이상
  if (b >= 800000)  return 15000;  // 5600 / 12100F 이상
  return 13000;                     // 모든 예산: Ryzen 1xxx/구식 CPU 배제
};

// CPU 단일 가격 상한 (예산 대비 %, 전문가 권장 10~20% 비율 기반)
// 13900K가 1.5M 예산에서 선택되는 등 오버킬 방지
// 저예산(<800K)은 plus 10% 완화: i3-14100F 등 14만원대 CPU 포함 보장
const cpuPriceCapRatio = (b, purpose) => {
  const base = purpose === "gaming" ? 0.25 : 0.22;
  return b < 800000 ? base + 0.10 : base; // 500~700K는 cap 35%/32%
};

// 메모리 단일 가격 상한 (32GB DDR5 같은 고가 메모리 폭주 방지)
const memoryPriceCapRatio = 0.25;

// CPU TDP 추정 (이름 기반, 쿨러 매칭용)
const estimateCpuTdp = (cpu) => {
  const n = cpu?.name || '';
  if (/9950X3D|9950X|7950X|14900K|13900K|285K|270K|265K/i.test(n)) return 170;
  if (/9900X3D|9900X|7900X3D|7900X|14700K|13700K|245K|250K|i7-?\d+K/i.test(n)) return 145;
  if (/9800X3D|9700|7800X3D|7700|14600K|13600K|i5-?\d+K/i.test(n)) return 110;
  if (/9600X|9600|7500X3D|7500F|7600|5800X3D|5700X3D/i.test(n)) return 85;
  if (/5600|5500|14400|13400|12400|11400|i5-?\d+(?!K)/i.test(n)) return 65;
  if (/5500GT|5600G|5700G|i3-?\d+|14100|13100|12100|라이젠3/i.test(n)) return 65;
  if (/1700|1600|1500X|1400|2700|2600|3600|3500|4500/i.test(n)) return 65;
  return 65;
};

// GPU TDP 추정 (이름 기반, PSU 매칭용 - 구형/중고 GPU의 실제 TDP 반영)
const estimateGpuTdp = (gpu) => {
  const n = gpu?.name || '';
  if (/5090/i.test(n)) return 575;
  if (/5080|7900\s*XTX|4090/i.test(n)) return 360;
  if (/3090|3080\s*Ti|7900\s*XT|4080/i.test(n)) return 350;
  if (/5070\s*Ti|9070\s*XT/i.test(n)) return 300;
  if (/3080(?!\s*Ti)|2080\s*Ti/i.test(n)) return 320;
  if (/5070(?!\s*Ti)|9070(?!\s*XT)|4070\s*Super|4070\s*Ti/i.test(n)) return 250;
  if (/3070|2080(?!\s*Ti)|6800/i.test(n)) return 220;
  if (/5060\s*Ti|9060\s*XT|4070(?!\s*S)/i.test(n)) return 180;
  if (/5060(?!\s*Ti)|4060\s*Ti|7700\s*XT|9060(?!\s*XT)/i.test(n)) return 165;
  if (/4060(?!\s*Ti)|7600|3060|6700|2070/i.test(n)) return 170;
  if (/3050|6600/i.test(n)) return 130;
  if (/1660|1030|GT\s?\d|580|570/i.test(n)) return 90;
  return 200; // 기본값
};

// 구식 CPU 판별 (Ryzen 1·2세대, Intel ≤9세대, FX, Athlon X4, Xeon/EPYC 등)
// 2026년 시점에서 일반 게이밍·작업용으로 추천 부적합
const isObsoleteCpu = (cpu) => {
  const n = cpu?.name || '';
  // AMD Ryzen 1세대 / 2세대 (2017~2018, Zen / Zen+ 아키텍처)
  if (/라이젠[\s\d]*-?[12]세대|ryzen.*\b(1[0-9]{3}|2[0-7][0-9]{2})\b/i.test(n)) return true;
  // Intel 1세대 ~ 9세대 코어 (2010~2019)
  const m = n.match(/코어\s*i\d-?(\d{1,2})세대/i);
  if (m && parseInt(m[1]) <= 9) return true;
  // 매우 구식 시리즈
  if (/FX-?\d{4}|애슬론|Athlon\s*X[24]|Phenom/i.test(n)) return true;
  // 서버/워크스테이션용 CPU (일반 데스크톱에 부적합, 호환 보드 거의 없음)
  if (/제온|Xeon|EPYC|에픽|Threadripper|스레드리퍼|Quadro/i.test(n)) return true;
  return false;
};

// 권장 PSU 와트 (CPU TDP + GPU TDP + 시스템 100W + 20% 안전마진)
// 업계 표준 (Corsair·Be Quiet PSU 계산기 기준 1.2~1.25 배수)
const recommendedPsuWatt = (cpuTdp, gpuTdp) => {
  const total = (cpuTdp + gpuTdp + 100) * 1.2;
  if (total < 500) return 500;
  if (total < 600) return 600;
  if (total < 700) return 700;
  if (total < 850) return 850;
  if (total < 1000) return 1000;
  if (total < 1200) return 1200;
  return 1300;
};

// PSU 이름에서 와트 추출
const extractPsuWatt = (psu) => {
  const m = (psu?.name || '').match(/(\d{3,4})\s*W/i);
  return m ? parseInt(m[1]) : 0;
};

// 쿨러 등급 추정 (이름 기반)
const coolerTierByTdp = (cpuTdp) => {
  if (cpuTdp >= 145) return 4; // 수랭 또는 듀얼타워
  if (cpuTdp >= 100) return 3; // 중급 타워 (AG620, RC1900 등)
  if (cpuTdp >= 80)  return 2; // 가성비 타워 (AG400)
  return 1;                    // 기본 쿨러 OK
};

const coolerRank = (cooler) => {
  const n = (cooler?.name || '').toLowerCase();
  if (/수랭|aio|kraken|titan|lcd|panorama|trident|360|420/i.test(n)) return 4;
  if (/d15|nh-d|nh-u12|peerless|valhalla|gl\d{3}|alpha|ag620|rc1900|rc1400|b360|gl360|ds[ -]?a/i.test(n)) return 3;
  if (/ag400|paladin|hyper|pccooler|cnps9x|tower/i.test(n)) return 2;
  return 1;
};

export async function buildCompatibleSetWithAIV2(budget, db, cpuBrand = "amd", gpuBrand = "nvidia", purpose = "gaming", {
  minCpuScore = 0, prevCpuComboPrice = 0,
  minGpuScore = 0, prevGpuPrice = 0,
} = {}) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 미설정");

  const { cpus, gpus, memories, boards, psus, coolers, storages, cases } = await loadParts(db);

  const brandWeightDocs = await db.collection("brand_weights").find().toArray().catch(() => []);
  const brandWeightMap = Object.fromEntries(brandWeightDocs.map((d) => [d.category, d.weights || {}]));

  const minBudget = budget;
  const maxBudget = budget + 100000;

  // ─── 헬퍼 ────────────────────────────────────────────────────────────────
  const TOP_N = 20; // 인기 상위 N개 풀에서 우선 선택

  // 인기순 정렬 후 상위 N개 → 없으면 전체로 폴백
  const popularTop = (arr, category, priceCap, n = TOP_N) => {
    const sorted = [...arr]
      .filter(p => p.price > 0 && p.price <= priceCap)
      .sort((a, b) => getPopularityScore(b, category, brandWeightMap) - getPopularityScore(a, category, brandWeightMap));
    return { top: sorted.slice(0, n), all: sorted };
  };

  const pickPopular = (arr, category, priceCap) => {
    const { top, all } = popularTop(arr, category, priceCap);
    return top[0] ?? all[0]; // 상위 20개 중 1위, 없으면 전체 1위
  };

  // 스토리지 필터: 실제 SSD/HDD만 (컨버터·어댑터·케이스·방열판 등 액세서리 배제)
  const realStorages = storages.filter(s => {
    const n = s.name || '';
    if (/컨버터|어댑터|adapter|케이스|enclosure|방열판|heatsink|도크|dock|케이블|cable|충전|확장카드/i.test(n)) return false;
    if (!/SSD|HDD|NVMe|M\.?2|SATA|디스크|disk|GB|TB/i.test(n)) return false;
    return true;
  });

  // ─── Phase 1: 보조부품 — 인기 상위 20개 풀에서 1순위 선택 ────────────────
  const secCap = budget * 0.22;
  const preStorage = pickPopular(realStorages, "storage", secCap * 0.40);
  const prePsu     = pickPopular(psus,         "psu",     secCap * 0.35);
  const preCase    = pickPopular(cases,        "case",    secCap * 0.28);
  const preCooler  = pickPopular(coolers,      "cooler",  secCap * 0.22);

  if (!preStorage || !prePsu || !preCase || !preCooler)
    throw new Error("필수 보조 부품(PSU/저장장치/케이스/쿨러)을 찾을 수 없음");

  const secondaryTotal = preStorage.price + prePsu.price + preCase.price + preCooler.price;

  // ─── Phase 2: CPU 조합 목록 — 가격 오름차순 ──────────────────────────────
  // 전문가 의견 반영:
  // - CPU 점수 최소값(예산 tier별)으로 구식 CPU 자동 배제 (Ryzen 1700 등)
  // - 콤보 빌드는 "가성비 호환 보드/메모리"(인기X, 가격↓) 사용 → 폴백 빈도 감소
  // - 1.5M+ 예산은 DDR5 32GB 우선 (전문가가 게이밍에서 32GB DDR5를 표준으로 권장)
  const allCombos = [];
  const cpuScoreFloor = minCpuScoreByBudget(budget);

  let cpusSorted = [...cpus]
    .filter(p => p.price > 0 && getCpuScore(p) >= cpuScoreFloor && !isObsoleteCpu(p))
    .sort((a, b) => a.price - b.price);
  // 점수 floor가 너무 빡빡하면 obsolete만 빼고 폴백
  if (cpusSorted.length === 0) {
    cpusSorted = [...cpus]
      .filter(p => p.price > 0 && !isObsoleteCpu(p))
      .sort((a, b) => a.price - b.price);
  }

  // 콤보 빌드용 "가성비 보드" — 50K 이상 신품 중 가격 오름차순
  const cheapBoardsSorted = [...boards]
    .filter(b => b.price >= 50000)
    .sort((a, b) => a.price - b.price);
  const allBoardsSorted = [...boards].filter(b => b.price > 0).sort((a, b) => a.price - b.price);

  // 콤보 빌드용 "가성비 메모리" — 30K 이상 가격 오름차순
  const cheapMemsSorted = [...memories]
    .filter(m => m.price >= 30000)
    .sort((a, b) => a.price - b.price);
  const allMemsSorted = [...memories].filter(m => m.price > 0).sort((a, b) => a.price - b.price);

  const pickBoardForCombo = (socket) => {
    return cheapBoardsSorted.find(b => isSocketCompatible(socket, extractBoardSocket(b)))
        ?? allBoardsSorted.find(b => isSocketCompatible(socket, extractBoardSocket(b)));
  };

  const memCap = budget * memoryPriceCapRatio;

  const pickMemoryForCombo = (board) => {
    // 1.5M+ 예산: DDR5 32GB 호환 메모리 우선 (단, 메모리 가격 cap 이내)
    if (budget >= 1500000) {
      const mem32 = cheapMemsSorted.find(m =>
        is32GbMemory(m) && /DDR5/i.test(m.name || '')
        && m.price <= memCap
        && isMemoryCompatible(m, board)
      );
      if (mem32) return mem32;
    }
    return cheapMemsSorted.find(m => isMemoryCompatible(m, board))
        ?? allMemsSorted.find(m => isMemoryCompatible(m, board));
  };

  // CPU 가격 상한 (오버킬 방지)
  const cpuPriceCap = budget * cpuPriceCapRatio(budget, purpose);

  for (const cpu of cpusSorted) {
    if (cpu.price > cpuPriceCap) continue;
    if (cpu.price > budget * 0.65) break;

    const socket = extractCpuSocket(cpu);
    const bestBoard = pickBoardForCombo(socket);
    if (!bestBoard) continue;

    const bestMem = pickMemoryForCombo(bestBoard);
    if (!bestMem) continue;

    allCombos.push({
      cpu, board: bestBoard, mem: bestMem,
      comboPrice: cpu.price + bestBoard.price + bestMem.price,
    });
  }

  if (allCombos.length === 0) throw new Error("호환되는 CPU+메인보드+메모리 조합을 찾을 수 없음");

  // ─── Phase 3: GPU 목록 — 가격 오름차순 ──────────────────────────────────
  const allGpus = [...gpus].filter(p => p.price > 0).sort((a, b) => a.price - b.price);

  // ─── Phase 4: 선택된 CPU/GPU 브랜드로 단일 최적화 ──────────────────────────

  // 브랜드 판별 헬퍼 (isGpuBrand 보다 먼저 정의)
  const isAmdCpu    = (cpu) => /amd|라이젠|ryzen|athlon/i.test(cpu.name || '');
  const isIntelCpu  = (cpu) => /intel|인텔|코어i|코어 i|코어 울트라|core i|core ultra|펜티엄|셀러론/i.test(cpu.name || '');
  const isAmdGpu    = (g)   => /라데온|radeon|\brx\b|rx\d/i.test(g.name || '');
  const isNvidiaGpu = (g)   => /지포스|geforce|rtx|gtx/i.test(g.name || '');

  const isCpuBrand = cpuBrand === "intel" ? isIntelCpu : isAmdCpu;
  const isGpuBrand = gpuBrand === "amd"   ? isAmdGpu   : isNvidiaGpu;

  // CPU 상한 = purpose별 비율 (게이밍 35% / 작업용 55%)
  const remaining = budget - secondaryTotal;
  const cpuRatio = CPU_RATIO_BY_PURPOSE[purpose] || 0.35;
  const maxCpuComboAllowed = remaining * cpuRatio;

  // 단조 증가 플로어
  const cpuFloor = (c) => {
    const s = getCpuScore(c.cpu);
    if (s > 0 && minCpuScore > 0) return s >= minCpuScore;
    if (prevCpuComboPrice > 0) return c.comboPrice >= prevCpuComboPrice;
    return true;
  };
  const gpuFloor = (g) => {
    const s = getGpuScore(g);
    if (s > 0 && minGpuScore > 0) return s >= minGpuScore;
    if (prevGpuPrice > 0) return g.price >= prevGpuPrice;
    return true;
  };

  const scoreDesc = (a, b) => {
    const sa = getCpuScore(a.cpu), sb = getCpuScore(b.cpu);
    if (sa !== sb) return sb - sa;
    return b.comboPrice - a.comboPrice;
  };

  // purpose 비율 내 후보 (없으면 해당 브랜드 최저가 조합으로 폴백)
  let withinRatio = [...allCombos]
    .filter(c => isCpuBrand(c.cpu) && c.comboPrice <= maxCpuComboAllowed);

  // 전문가 의견 반영:
  // - 게이밍 AMD: X3D 시리즈(3D V-Cache) 우선 (프레임 방어)
  // - 게이밍 Intel: K/KF/KS 시리즈 우선 (고클럭 게이밍 특화)
  // - 작업용 AMD: X3D 배제 (멀티코어 우선, 9950X 같은 고코어 CPU 선택)
  // - 작업용 Intel: K/KF 시리즈 우선 (270K처럼 고멀티성능)
  // 후보가 있을 때만 해당 풀로 좁히고, 없으면 폴백으로 전체 풀 유지
  if (purpose === "gaming") {
    if (cpuBrand === "amd") {
      const x3dPool = withinRatio.filter(c => isX3dCpu(c.cpu));
      if (x3dPool.length > 0) withinRatio = x3dPool;
    } else { // intel
      const kPool = withinRatio.filter(c => isIntelKSeries(c.cpu));
      if (kPool.length > 0) withinRatio = kPool;
    }
  } else if (purpose === "work") {
    if (cpuBrand === "amd") {
      const nonX3dPool = withinRatio.filter(c => !isX3dCpu(c.cpu));
      if (nonX3dPool.length > 0) withinRatio = nonX3dPool;
    } else { // intel
      // 작업용 Intel은 K 시리즈 우선 (멀티코어 풀 성능)
      const kPool = withinRatio.filter(c => isIntelKSeries(c.cpu));
      if (kPool.length > 0) withinRatio = kPool;
    }
  }

  withinRatio.sort(scoreDesc);

  const comboPool = withinRatio.length > 0
    ? withinRatio
    : [...allCombos].filter(c => isCpuBrand(c.cpu)).sort((a, b) => a.comboPrice - b.comboPrice);

  if (comboPool.length === 0)
    throw new Error(`${budget.toLocaleString()}원 예산에서 ${cpuBrand.toUpperCase()} CPU 조합을 찾을 수 없음`);

  const chosenCombo = comboPool.find(cpuFloor) ?? comboPool[0];

  // GPU 예산: 이 CPU 조합 기준으로 계산 + purpose별 하드캡 (작업용 35%)
  const gpuAbsoluteCap = GPU_RATIO_BY_PURPOSE[purpose] != null ? budget * GPU_RATIO_BY_PURPOSE[purpose] : Infinity;
  const gpuCap = Math.min(maxBudget - secondaryTotal - chosenCombo.comboPrice, gpuAbsoluteCap);
  const gpuPool = [...allGpus]
    .filter(g => isGpuBrand(g) && g.price < gpuCap)
    .sort((a, b) => {
      const sa = getGpuScore(a), sb = getGpuScore(b);
      if (sa !== sb) return sb - sa;
      return b.price - a.price;
    });
  const chosenGpu = gpuPool.find(gpuFloor) ?? gpuPool[0] ?? null;

  // ─── Phase 4.5: PSU·쿨러 TDP 매칭 (전문가 의견 반영) ─────────────────────
  // CPU/GPU TDP 기반으로 권장 PSU 와트와 쿨러 등급 계산.
  // 현재 인기-우선 선택이 부족하면 cheapest 적합 부품으로 업그레이드 (예산 초과 시 유지)
  let fillStorage = preStorage, fillPsu = prePsu, fillCase = preCase, fillCooler = preCooler;

  const cpuTdp = estimateCpuTdp(chosenCombo.cpu);
  const gpuTdp = chosenGpu ? estimateGpuTdp(chosenGpu) : 0;
  const requiredWatt = recommendedPsuWatt(cpuTdp, gpuTdp);
  const requiredCoolerTier = coolerTierByTdp(cpuTdp);

  const currentTotalWithoutPart = (excludePart) =>
    fillStorage.price + fillPsu.price + fillCase.price + fillCooler.price +
    chosenCombo.comboPrice + (chosenGpu?.price || 0) - excludePart.price;

  // 신뢰 브랜드 패턴 (전문가 추천 브랜드, 무명 PSU 위험 회피)
  const TRUSTED_PSU_BRANDS = /마이크로닉스|시소닉|seasonic|\bFSP\b|SuperFlower|슈퍼플라워|COUGAR|쿠거|ANTEC|안텍|CORSAIR|커세어|NZXT|EVGA|대원|MSI|XPG|ADATA|에너맥스|Enermax|Thermaltake|써멀테이크/i;
  const TRUSTED_COOLER_BRANDS = /DEEPCOOL|딥쿨|NOCTUA|녹투아|Thermalright|써멀라이트|쿨러마스터|Cooler\s*Master|잘만|Zalman|NZXT|크라켄|kraken|발키리|valkyrie|3RSYS|PentaWave|ARCTIC|아틱|MSI|CORSAIR|TRYX/i;

  // PSU 와트 충족 PSU로 교체 (신뢰 브랜드 우선, 폴백 cheapest)
  if (extractPsuWatt(fillPsu) < requiredWatt) {
    const psuBudget = maxBudget - currentTotalWithoutPart(fillPsu);
    const candidates = psus
      .filter(p => p.price > 0 && extractPsuWatt(p) >= requiredWatt && p.price <= psuBudget);
    const trusted = candidates.filter(p => TRUSTED_PSU_BRANDS.test(p.name)).sort((a, b) => a.price - b.price);
    const upgraded = trusted[0] ?? candidates.sort((a, b) => a.price - b.price)[0];
    if (upgraded) fillPsu = upgraded;
  }

  // 쿨러 등급 충족 쿨러로 교체 (신뢰 브랜드 우선)
  if (coolerRank(fillCooler) < requiredCoolerTier) {
    const coolerBudget = maxBudget - currentTotalWithoutPart(fillCooler);
    const candidates = coolers
      .filter(c => c.price > 0 && coolerRank(c) >= requiredCoolerTier && c.price <= coolerBudget);
    const trusted = candidates.filter(c => TRUSTED_COOLER_BRANDS.test(c.name)).sort((a, b) => a.price - b.price);
    const upgraded = trusted[0] ?? candidates.sort((a, b) => a.price - b.price)[0];
    if (upgraded) fillCooler = upgraded;
  }

  // ─── Phase 5: Gap fill — 실제 CPU+GPU 기준으로 소폭 미달 시 보조부품 업그레이드 ─

  const calcTotal = () =>
    fillStorage.price + fillPsu.price + fillCase.price + fillCooler.price +
    chosenCombo.comboPrice + (chosenGpu?.price || 0);

  if (calcTotal() < minBudget) {
    const window = maxBudget - minBudget;
    const fillCandidates = [
      { arr: storages, get: () => fillStorage, set: (v) => { fillStorage = v; } },
      { arr: psus,     get: () => fillPsu,     set: (v) => { fillPsu = v;     } },
      { arr: cases,    get: () => fillCase,    set: (v) => { fillCase = v;    } },
      { arr: coolers,  get: () => fillCooler,  set: (v) => { fillCooler = v;  } },
    ];
    for (const { arr, get, set } of fillCandidates) {
      const gap = minBudget - calcTotal();
      if (gap <= 0) break;
      const cur = get();
      const upgrade = arr
        .filter(p => p.price >= cur.price + gap && p.price < cur.price + gap + window)
        .sort((a, b) => a.price - b.price)[0]
        ?? arr
          .filter(p => p.price > cur.price && p.price <= cur.price + gap + window)
          .sort((a, b) => b.price - a.price)[0];
      if (upgrade && upgrade.price > cur.price) set(upgrade);
    }
  }

  // ─── AI: 요약문 + 상세 추천 이유 생성 ─────────────────────────────────────
  let aiSummary = null;
  let aiReasoning = null;
  try {
    const purposeKr = purpose === "gaming" ? "게이밍" : "작업용";
    const cpuName = chosenCombo.cpu.name;
    const gpuName = chosenGpu?.name || "내장그래픽";
    const cpuTypeHint = isX3dCpu(chosenCombo.cpu)
      ? "X3D(3D V-Cache, 게이밍 프레임 방어 특화)"
      : (purpose === "work" ? "멀티코어 작업 특화" : "범용");
    const nvidiaHintForWork = (purpose === "work" && gpuBrand === "amd")
      ? "\n- 참고: 영상편집·렌더링 가속(NVENC, CUDA)은 NVIDIA가 더 강력합니다."
      : "";

    const prompt = `다음 PC 견적의 추천 이유를 작성해주세요.

견적 정보:
- 예산: ${budget.toLocaleString()}원
- 용도: ${purposeKr}
- CPU: ${cpuName} (${cpuTypeHint})
- GPU: ${gpuName}
- 메모리: ${chosenCombo.mem.name}
- 메인보드: ${chosenCombo.board.name}
- 사용자 브랜드 선택: CPU ${cpuBrand.toUpperCase()}, GPU ${gpuBrand.toUpperCase()}${nvidiaHintForWork}

응답 형식 (JSON):
{
  "summary": "30자 이내 한 줄 요약 (용도·특징 포함)",
  "reasoning": "200자 내외의 추천 이유. 다음을 포함: ① 이 CPU/GPU가 이 예산·용도에 적합한 이유 ② 어떤 작업/게임에 적합한지(FHD/QHD/4K, 프로그램명 등 구체적으로) ③ 주의사항이나 팁(있을 시). 자연스러운 한국어 문단으로 작성. 글머리표 사용 금지."
}

JSON만 출력하고 다른 설명은 금지.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      const d = await resp.json();
      const content = d?.choices?.[0]?.message?.content?.trim() || "";
      // JSON 파싱 시도 (앞뒤 마크다운 코드블록 제거 후)
      const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      try {
        const parsed = JSON.parse(jsonStr);
        aiSummary = parsed.summary?.trim() || null;
        aiReasoning = parsed.reasoning?.trim() || null;
      } catch (_) {
        // JSON 파싱 실패 시 첫 줄을 summary, 나머지를 reasoning으로
        const lines = content.split('\n').filter(l => l.trim());
        aiSummary = lines[0]?.slice(0, 50) || null;
        aiReasoning = lines.slice(1).join(' ').trim() || content;
      }
    }
  } catch (_) { /* summary fallback */ }

  const toPartObj = (p, cat) => p ? { name: p.name, price: p.price, image: p.image || null, category: cat } : null;

  const basePrice = fillStorage.price + fillPsu.price + fillCase.price + fillCooler.price;
  const finalTotal = basePrice + chosenCombo.comboPrice + (chosenGpu?.price || 0);

  logger.info(
    `[V2] 예산 ${budget.toLocaleString()}원 [${cpuBrand}+${gpuBrand}]` +
    ` → CPU: ${chosenCombo.cpu.name}` +
    ` / GPU: ${chosenGpu?.name || "없음"}` +
    ` / 총합: ${finalTotal.toLocaleString()}원 (${finalTotal >= minBudget && finalTotal < maxBudget ? "✅" : "⚠️"})`
  );

  return {
    budget,
    cpuBrand,
    gpuBrand,
    purpose,
    basePrice,
    totalPrice: finalTotal,
    computedAt: new Date().toISOString(),
    parts: {
      cpu:         toPartObj(chosenCombo.cpu,   "cpu"),
      motherboard: toPartObj(chosenCombo.board, "motherboard"),
      memory:      toPartObj(chosenCombo.mem,   "memory"),
      ...(chosenGpu && { gpu: toPartObj(chosenGpu, "gpu") }),
      storage: toPartObj(fillStorage, "storage"),
      psu:     toPartObj(fillPsu,     "psu"),
      cooler:  toPartObj(fillCooler,  "cooler"),
      case:    toPartObj(fillCase,    "case"),
    },
    summary: aiSummary || `${budget.toLocaleString()}원 ${purpose === "gaming" ? "게이밍" : "작업용"} PC (${cpuBrand.toUpperCase()}+${gpuBrand.toUpperCase()})`,
    reasoning: aiReasoning || null,
    compatibilityVerified: true,
    _meta: {
      cpuScore:      getCpuScore(chosenCombo.cpu),
      cpuComboPrice: chosenCombo.comboPrice,
      gpuScore:      chosenGpu ? getGpuScore(chosenGpu) : 0,
      gpuPrice:      chosenGpu?.price || 0,
    },
  };
}

async function saveBudgetSetV2ToDb(db, budget, cpuBrand, gpuBrand, purpose, result) {
  const _id = `budget-set-v2:${budget}:${cpuBrand}:${gpuBrand}:${purpose}`;
  await db.collection("cached_sets_v2").replaceOne({ _id }, { _id, budget, cpuBrand, gpuBrand, purpose, result, computedAt: new Date() }, { upsert: true });
}

function checkAdminKey(req, res) {
  const key = req.headers["authorization"]?.replace("Bearer ", "");
  if (!config.adminApiKey || key !== config.adminApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* ==================== 엔드포인트 ==================== */

// GET /api/recommend/budget-set-v2?budget=1500000&cpuBrand=amd&gpuBrand=nvidia&purpose=gaming
router.get("/budget-set-v2", validate(recommendV2Schema, "query"), async (req, res) => {
  const budget = Number(req.query.budget);
  const cpuBrand = req.query.cpuBrand || "amd";
  const gpuBrand = req.query.gpuBrand || "nvidia";
  const purpose  = req.query.purpose  || "gaming";
  const cacheId = `budget-set-v2:${budget}:${cpuBrand}:${gpuBrand}:${purpose}`;
  const memKey = `recommend:${cacheId}`;

  const memHit = getCache(memKey);
  if (memHit?.parts) {
    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return res.json(memHit);
  }

  const db = getDB();
  if (!db) return res.status(500).json({ error: "DATABASE_ERROR", message: "DB 연결 실패" });

  try {
    const doc = await db.collection("cached_sets_v2").findOne({ _id: cacheId });

    if (doc?.result?.parts) {
      if (!doc.result.compatibilityVerified && !buildingInProgressV2.has(cacheId)) {
        buildingInProgressV2.add(cacheId);
        logger.info(`budget-set-v2 호환성 미검증 캐시 — 즉시 재빌드: ${cacheId}`);
        buildCompatibleSetWithAIV2(budget, db, cpuBrand, gpuBrand, purpose)
          .then(async (fresh) => {
            if (!fresh?.parts) return;
            await saveBudgetSetV2ToDb(db, budget, cpuBrand, gpuBrand, purpose, fresh);
            setCache(memKey, fresh, 10 * 60 * 1000);
          })
          .catch(e => logger.error(`budget-set-v2 재빌드 실패: ${e.message}`))
          .finally(() => buildingInProgressV2.delete(cacheId));
        return res.status(503).json({ error: "NOT_READY", message: "호환 세트를 재검증 중입니다. 잠시 후 다시 시도해주세요.", retryAfter: 60 });
      }
      const age = Date.now() - new Date(doc.computedAt).getTime();
      setCache(memKey, doc.result, 10 * 60 * 1000);
      res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      if (age > BUDGET_SET_V2_TTL_MS && !buildingInProgressV2.has(cacheId)) {
        buildingInProgressV2.add(cacheId);
        logger.info(`budget-set-v2 stale (${Math.round(age / 86400000)}d) — 백그라운드 갱신: ${cacheId}`);
        buildCompatibleSetWithAIV2(budget, db, cpuBrand, gpuBrand, purpose)
          .then(async (fresh) => {
            if (!fresh?.parts) return;
            await saveBudgetSetV2ToDb(db, budget, cpuBrand, gpuBrand, purpose, fresh);
            setCache(memKey, fresh, 10 * 60 * 1000);
          })
          .catch(e => logger.error(`budget-set-v2 백그라운드 갱신 실패: ${e.message}`))
          .finally(() => buildingInProgressV2.delete(cacheId));
      }
      return res.json(doc.result);
    }

    if (!buildingInProgressV2.has(cacheId)) {
      buildingInProgressV2.add(cacheId);
      buildCompatibleSetWithAIV2(budget, db, cpuBrand, gpuBrand, purpose)
        .then(async (result) => {
          if (!result?.parts) return;
          await saveBudgetSetV2ToDb(db, budget, cpuBrand, gpuBrand, purpose, result);
          setCache(memKey, result, 10 * 60 * 1000);
        })
        .catch(e => logger.error(`budget-set-v2 초기 계산 실패 [${cacheId}]: ${e.message}`))
        .finally(() => buildingInProgressV2.delete(cacheId));
    }

    return res.status(503).json({
      error: "NOT_READY",
      message: "호환 세트를 준비 중입니다. 잠시 후 다시 시도해주세요.",
      retryAfter: 60,
    });
  } catch (err) {
    logger.error(`budget-set-v2 오류: ${err.message}`);
    res.status(500).json({ error: "추천 생성 실패" });
  }
});

router.post("/budget-set-v2/refresh", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const budget = parseInt(req.body?.budget) || 1500000;
  const COMBOS = [["amd","nvidia"],["amd","amd"],["intel","nvidia"],["intel","amd"]];
  const PURPOSES = ["gaming", "work"];
  const results = [];
  try {
    for (const purpose of PURPOSES) {
      for (const [cpuBrand, gpuBrand] of COMBOS) {
        logger.info(`budget-set-v2 갱신 시작: ${budget.toLocaleString()}원 [${cpuBrand}+${gpuBrand}:${purpose}]`);
        const result = await buildCompatibleSetWithAIV2(budget, db, cpuBrand, gpuBrand, purpose);
        await saveBudgetSetV2ToDb(db, budget, cpuBrand, gpuBrand, purpose, result);
        setCache(`recommend:budget-set-v2:${budget}:${cpuBrand}:${gpuBrand}:${purpose}`, result, 10 * 60 * 1000);
        results.push({ cpuBrand, gpuBrand, purpose, totalPrice: result.totalPrice });
      }
    }
    res.json({ status: "ok", budget, results });
  } catch (e) {
    logger.error(`budget-set-v2 갱신 실패 ${budget}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// 16 budgets × 4 brand combos × 2 purposes = 128 entries — 주 1회 GitHub Actions
router.post("/budget-set-v2/refresh-all", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const budgets = Array.from({ length: 16 }, (_, i) => 500000 + i * 100000);
  const COMBOS = [["amd","nvidia"],["amd","amd"],["intel","nvidia"],["intel","amd"]];
  const PURPOSES = ["gaming", "work"];
  res.json({ status: "started", total: budgets.length * COMBOS.length * PURPOSES.length });

  (async () => {
    const db = getDB();
    if (!db) return;
    let success = 0, fail = 0;
    for (const purpose of PURPOSES) {
      for (const [cpuBrand, gpuBrand] of COMBOS) {
        for (const budget of budgets) {
          try {
            const result = await buildCompatibleSetWithAIV2(budget, db, cpuBrand, gpuBrand, purpose);
            await saveBudgetSetV2ToDb(db, budget, cpuBrand, gpuBrand, purpose, result);
            setCache(`recommend:budget-set-v2:${budget}:${cpuBrand}:${gpuBrand}:${purpose}`, result, 10 * 60 * 1000);
            logger.info(`budget-set-v2 완료: ${budget.toLocaleString()}원 [${cpuBrand}+${gpuBrand}:${purpose}] → ${result.totalPrice?.toLocaleString()}원`);
            success++;
          } catch (err) {
            logger.error(`budget-set-v2 실패: ${budget.toLocaleString()}원 [${cpuBrand}+${gpuBrand}:${purpose}] — ${err.message}`);
            fail++;
          }
          await sleep(2000);
        }
      }
    }
    logger.info(`budget-set-v2 refresh-all 완료: 성공 ${success}개, 실패 ${fail}개`);
  })();
});

export default router;
