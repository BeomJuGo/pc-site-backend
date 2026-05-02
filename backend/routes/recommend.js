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
const CPU_RATIO_BY_PURPOSE = { gaming: 0.35, work: 0.55 };

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
  const popularFirst = (arr, category, priceCap) =>
    [...arr]
      .filter(p => p.price > 0 && p.price <= priceCap)
      .sort((a, b) => getPopularityScore(b, category, brandWeightMap) - getPopularityScore(a, category, brandWeightMap));

  // ─── Phase 1: 보조부품 — 인기순 (예산의 약 22% 범위 내) ──────────────────
  const secCap = budget * 0.22;
  const preStorage = popularFirst(storages, "storage", secCap * 0.40)[0];
  const prePsu     = popularFirst(psus,     "psu",     secCap * 0.35)[0];
  const preCase    = popularFirst(cases,    "case",    secCap * 0.28)[0];
  const preCooler  = popularFirst(coolers,  "cooler",  secCap * 0.22)[0];

  if (!preStorage || !prePsu || !preCase || !preCooler)
    throw new Error("필수 보조 부품(PSU/저장장치/케이스/쿨러)을 찾을 수 없음");

  const secondaryTotal = preStorage.price + prePsu.price + preCase.price + preCooler.price;

  // ─── Phase 2: CPU 조합 목록 — 가격 오름차순 ──────────────────────────────
  // 각 CPU마다 가장 저렴한 호환 보드 + 가장 저렴한 호환 메모리 조합 생성
  const allCombos = [];
  const cpusSorted = [...cpus].filter(p => p.price > 0).sort((a, b) => a.price - b.price);

  for (const cpu of cpusSorted) {
    if (cpu.price > budget * 0.65) break; // CPU가 예산 65% 초과 시 중단

    const socket = extractCpuSocket(cpu);
    const cheapBoard = [...boards]
      .filter(b => b.price > 0 && isSocketCompatible(socket, extractBoardSocket(b)))
      .sort((a, b) => a.price - b.price)[0];
    if (!cheapBoard) continue;

    const cheapMem = [...memories]
      .filter(m => m.price > 0 && isMemoryCompatible(m, cheapBoard))
      .sort((a, b) => a.price - b.price)[0];
    if (!cheapMem) continue;

    allCombos.push({
      cpu, board: cheapBoard, mem: cheapMem,
      comboPrice: cpu.price + cheapBoard.price + cheapMem.price,
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
  const withinRatio = [...allCombos]
    .filter(c => isCpuBrand(c.cpu) && c.comboPrice <= maxCpuComboAllowed)
    .sort(scoreDesc);

  const comboPool = withinRatio.length > 0
    ? withinRatio
    : [...allCombos].filter(c => isCpuBrand(c.cpu)).sort((a, b) => a.comboPrice - b.comboPrice);

  if (comboPool.length === 0)
    throw new Error(`${budget.toLocaleString()}원 예산에서 ${cpuBrand.toUpperCase()} CPU 조합을 찾을 수 없음`);

  const chosenCombo = comboPool.find(cpuFloor) ?? comboPool[0];

  // GPU 예산: 이 CPU 조합 기준으로 정확하게 계산
  const gpuCap = maxBudget - secondaryTotal - chosenCombo.comboPrice;
  const gpuPool = [...allGpus]
    .filter(g => isGpuBrand(g) && g.price < gpuCap)
    .sort((a, b) => {
      const sa = getGpuScore(a), sb = getGpuScore(b);
      if (sa !== sb) return sb - sa;
      return b.price - a.price;
    });
  const chosenGpu = gpuPool.find(gpuFloor) ?? gpuPool[0] ?? null;

  // ─── Phase 5: Gap fill — 실제 CPU+GPU 기준으로 소폭 미달 시 보조부품 업그레이드 ─
  let fillStorage = preStorage, fillPsu = prePsu, fillCase = preCase, fillCooler = preCooler;

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

  // ─── AI: 요약문 생성 ─────────────────────────────────────────────────────
  let aiSummary = null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{
          role: "user",
          content: `다음 PC 견적을 30자 이내 한 줄로 요약해줘 (용도·특징 포함):\n예산: ${budget.toLocaleString()}원\n용도: ${purpose === "gaming" ? "게이밍용" : "작업용"}\nCPU: ${chosenCombo.cpu.name}\nGPU: ${chosenGpu?.name || "없음"}`,
        }],
        max_completion_tokens: 80,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      const d = await resp.json();
      aiSummary = d?.choices?.[0]?.message?.content?.trim() || null;
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
