// routes/recommend.js
import express from "express";
import { getDB } from "../db.js";
import config from "../config.js";
import { loadParts, extractBoardFormFactor, isCaseCompatible } from "../utils/recommend-helpers.js";
import { getPopularityScore } from "../utils/naverDatalab.js";
import logger from "../utils/logger.js";
import { validate } from "../middleware/validate.js";
import { recommendSchema, recommendV2Schema } from "../schemas/recommend.js";
import { upgradeAdvisorSchema } from "../schemas/recommend.js";
import { getCache, setCache } from "../utils/responseCache.js";

const OPENAI_API_KEY = config.openaiApiKey;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const router = express.Router();

const buildingInProgress = new Set();
const buildingInProgressV2 = new Set();

const BUDGET_SET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHED_PURPOSES = ["게임용", "작업용"];

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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findPartForUpgrade(db, category, rawName) {
  if (!rawName) return null;
  const name = rawName.trim();
  const proj = { projection: { name: 1, price: 1, benchmarkScore: 1 } };
  let part = await db.collection("parts").findOne({ category, name }, proj);
  if (part) return part;
  const escaped = escapeRegex(name);
  part = await db.collection("parts").findOne({ category, name: { $regex: escaped, $options: "i" } }, proj);
  return part || null;
}

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
  const m = text.toUpperCase().match(/DDR([45])/);
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
  const bDdr = extractDdrType(board.info || board.specSummary || "");
  const mDdr = extractDdrType(memory.name || memory.info || "");
  if (bDdr && mDdr && bDdr !== mDdr) return false;
  const spd = extractMemorySpeed(memory.name || memory.info || "");
  if (spd > 0) {
    const r = extractBoardMemorySpeedRange(board);
    if (spd < r.min || spd > r.max) return false;
  }
  return true;
}

function extractMemoryCapacity(memory) {
  const text = `${memory.name || ""} ${memory.info || ""}`.toUpperCase();
  for (const pat of [/(\d+)\s*GB\s*\(/i, /(\d+)\s*GB(?!\s*X)/i, /GB\s*(\d+)/i]) {
    const m = text.match(pat);
    if (m) { const c = parseInt(m[1]); if (c >= 4 && c <= 256) return c; }
  }
  return 16;
}

function extractTdp(text = "") {
  const m = text.match(/TDP[:\s]*(\d+)\s*W/i) || text.match(/(\d+)\s*W/i);
  return m ? parseInt(m[1]) : 0;
}

function parseCoolerSpecs(cooler) {
  const text = `${cooler.name || ""} ${cooler.info || ""} ${cooler.specSummary || ""}`.toUpperCase();
  const sockets = [];
  if (/AM5/i.test(text)) sockets.push("AM5");
  if (/AM4/i.test(text)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(text)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(text)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1X]/i.test(text)) sockets.push("LGA115X");
  const tm = text.match(/TDP[:\s]*(\d{2,3})W?/i);
  return { sockets, tdpW: tm ? parseInt(tm[1]) : 0 };
}

function isCoolerCompatible(cooler, cpuSocket, cpuTdp) {
  const { sockets, tdpW } = parseCoolerSpecs(cooler);
  const norm = normalizeSocket(cpuSocket);
  if (!sockets.some(s => normalizeSocket(s) === norm) && cpuSocket) return false;
  if (tdpW > 0 && cpuTdp > 0 && tdpW < cpuTdp * 0.8) return false;
  return true;
}

const getCpuScore = (cpu) => cpu.benchmarkScore?.passmarkscore || cpu.benchScore || 0;
const getGpuScore = (gpu) => gpu.benchmarkScore?.["3dmarkscore"] || gpu.benchScore || 0;

function checkBottleneck(cpuScore, gpuScore, purpose, userBudget) {
  if (cpuScore <= 0 || gpuScore <= 0) return true;
  const baseRatios = { "게임용": { min: 0.4, max: 2.5 }, "작업용": { min: 0.7, max: 2.0 }, "사무용": { min: 0.3, max: 3.0 }, "가성비": { min: 0.5, max: 2.0 } };
  let ratio = baseRatios[purpose] || baseRatios["가성비"];
  if (userBudget < 700000) ratio = { min: 0.2, max: 4.0 };
  else if (userBudget < 1000000) ratio = { min: Math.max(0.3, ratio.min * 0.6), max: Math.min(3.5, ratio.max * 1.5) };
  else if (userBudget < 3000000) ratio = { min: Math.max(0.35, ratio.min * 0.8), max: Math.min(3.0, ratio.max * 1.3) };
  const cpuR = Math.min(cpuScore / 80000, 1);
  const gpuR = Math.min(gpuScore / 60000, 1);
  const r = gpuR / (cpuR || 0.1);
  return r >= ratio.min && r <= ratio.max;
}

/* ==================== DB 캐시 조회 헬퍼 ==================== */

async function getCachedBudgetSet(db, budget, purpose) {
  const roundedBudget = Math.round(budget / 100000) * 100000;
  const clampedBudget = Math.max(500000, Math.min(3000000, roundedBudget));
  const memKey = `recommend:budget-set:${clampedBudget}:${purpose}`;
  let cached = getCache(memKey);
  if (cached?.parts) return { cached, clampedBudget };
  try {
    const doc = await db.collection("cached_sets").findOne({ _id: `budget-set:${clampedBudget}:${purpose}` });
    if (doc?.result?.parts) {
      setCache(memKey, doc.result, 10 * 60 * 1000);
      return { cached: doc.result, clampedBudget };
    }
  } catch (_) {}
  return { cached: null, clampedBudget };
}

/* ==================== 코드 기반 견적 (fallback) ==================== */

async function buildCompatibleSet(budget, purpose, db) {
  const { cpus, gpus, memories, boards, psus, coolers, storages, cases } = await loadParts(db);
  const weights = {
    "사무용": { cpu: 0.4, gpu: 0.2, cpuBR: 0.25, gpuBR: 0.15 },
    "게임용": { cpu: 0.45, gpu: 0.6, cpuBR: 0.30, gpuBR: 0.40 },
    "작업용": { cpu: 0.5, gpu: 0.4, cpuBR: 0.30, gpuBR: 0.25 },
    "가성비": { cpu: 0.4, gpu: 0.5, cpuBR: 0.25, gpuBR: 0.30 },
  };
  const w = weights[purpose] || weights["가성비"];
  const minB = budget * 0.90, maxB = budget * 1.10;
  const maxCpu = budget * w.cpuBR, idealCpu = maxCpu * 0.7;
  const maxGpu = budget * w.gpuBR, idealGpu = maxGpu * 0.7;

  let cpuCands = cpus.filter(c => {
    if (purpose === "게임용" && /제온|XEON|EPYC|THREADRIPPER/i.test(c.name || "")) return false;
    return c.price <= maxCpu && extractCpuSocket(c) !== "";
  });
  if (!cpuCands.length) cpuCands = cpus.filter(c => {
    if (purpose === "게임용" && /제온|XEON|EPYC|THREADRIPPER/i.test(c.name || "")) return false;
    return c.price <= maxCpu;
  });
  cpuCands = cpuCands.map(c => {
    const sc = getCpuScore(c);
    const vs = sc > 0 ? (sc / c.price) * w.cpu : 0;
    const bf = 1 / (1 + Math.abs(c.price - idealCpu) / idealCpu);
    return { ...c, _ws: sc > 0 ? vs * 0.6 + bf * 0.4 : bf };
  }).sort((a, b) => b._ws - a._ws).slice(0, 12);

  const gpuCands = gpus.filter(g => getGpuScore(g) > 0 && g.price <= maxGpu).map(g => {
    const vs = (getGpuScore(g) / g.price) * w.gpu;
    const bf = 1 / (1 + Math.abs(g.price - idealGpu) / idealGpu);
    return { ...g, _ws: vs * 0.6 + bf * 0.4 };
  }).sort((a, b) => b._ws - a._ws).slice(0, 12);

  if (!cpuCands.length || !gpuCands.length) return null;

  const results = [];
  for (const cpu of cpuCands) {
    for (const gpu of gpuCands) {
      if (results.length >= 50) break;
      if (!checkBottleneck(getCpuScore(cpu), getGpuScore(gpu), purpose, budget)) continue;
      const cgCost = cpu.price + gpu.price;
      const rem = budget - cgCost;
      if (cgCost > budget * 0.70 || rem < 150000) continue;
      const cpuSocket = extractCpuSocket(cpu);
      if (!cpuSocket) continue;

      const bBd = rem * 0.20, mBd = rem * 0.15, pBd = rem * 0.12, cBd = rem * 0.08, sBd = rem * 0.25, caBd = rem * 0.20;

      const bds = boards.filter(b => isSocketCompatible(cpuSocket, extractBoardSocket(b)) && b.price <= bBd * 1.5 && b.price >= 30000);
      if (!bds.length) continue;
      const board = bds.sort((a, b) => Math.abs(a.price - bBd) - Math.abs(b.price - bBd))[0];
      const boardFF = extractBoardFormFactor(board);

      let capReq = purpose === "작업용" ? 32 : 16;
      let mems = memories.filter(m => isMemoryCompatible(m, board) && extractMemoryCapacity(m) >= capReq && m.price <= mBd * 2.0 && m.price >= 30000);
      if (!mems.length) {
        const bDdr = extractDdrType(board.info || board.specSummary || "");
        mems = memories.filter(m => {
          const md = extractDdrType(m.name || m.info || "");
          if (bDdr && md && bDdr !== md) return false;
          return extractMemoryCapacity(m) >= Math.max(8, capReq * 0.5) && m.price <= mBd * 3.0 && m.price >= 30000;
        });
      }
      if (!mems.length) continue;
      const memory = mems.sort((a, b) => {
        const ac = extractMemoryCapacity(a), bc = extractMemoryCapacity(b);
        return ac !== bc ? bc - ac : Math.abs(a.price - mBd) - Math.abs(b.price - mBd);
      })[0];

      const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
      const gpuTdp = extractTdp(gpu.info || "");
      const totalTdp = cpuTdp + gpuTdp + 100;

      let psusF = psus.filter(p => extractTdp(p.name || p.info || "") >= totalTdp * 1.2 && p.price <= pBd * 1.5 && p.price >= 40000);
      if (!psusF.length) psusF = psus.filter(p => p.price >= 40000 && p.price <= pBd * 2.0);
      if (!psusF.length) continue;
      const psu = psusF.sort((a, b) => Math.abs(a.price - pBd) - Math.abs(b.price - pBd))[0];

      let coolersF = coolers.filter(c => isCoolerCompatible(c, cpuSocket, cpuTdp) && c.price <= cBd * 1.5 && c.price >= 15000);
      if (!coolersF.length) coolersF = coolers.filter(c => c.price >= 15000 && c.price <= cBd * 2.0);
      if (!coolersF.length) continue;
      const cooler = coolersF.sort((a, b) => {
        const as = parseCoolerSpecs(a), bs = parseCoolerSpecs(b);
        if (cpuTdp > 0 && as.tdpW > 0 && bs.tdpW > 0) {
          const am = as.tdpW - cpuTdp, bm = bs.tdpW - cpuTdp;
          if (Math.abs(am - bm) > 20) return bm - am;
        }
        return Math.abs(a.price - cBd) - Math.abs(b.price - cBd);
      })[0];

      const remAfterCooler = rem - board.price - memory.price - psu.price - cooler.price;
      const stors = storages.filter(s => s.price <= Math.min(sBd * 1.2, remAfterCooler * 0.6) && s.price >= 50000);
      if (!stors.length) continue;
      const storage = stors.sort((a, b) => Math.abs(a.price - sBd) - Math.abs(b.price - sBd))[0];

      const remAfterStorage = remAfterCooler - storage.price;
      const caseBudgetAdj = Math.max(remAfterStorage, 30000);
      const casesF = cases.filter(c => isCaseCompatible(c, boardFF) && c.price <= caseBudgetAdj && c.price >= 30000);
      if (!casesF.length) continue;
      const idealCasePrice = Math.min(caseBudgetAdj * 0.8, caBd);
      const caseItem = casesF.sort((a, b) => Math.abs(a.price - idealCasePrice) - Math.abs(b.price - idealCasePrice))[0];

      const totalPrice = cpu.price + gpu.price + memory.price + board.price + psu.price + cooler.price + storage.price + caseItem.price;
      if (totalPrice < minB || totalPrice > maxB) continue;

      const score = getCpuScore(cpu) * w.cpu + getGpuScore(gpu) * w.gpu;
      results.push({ cpu, gpu, memory, board, psu, cooler, storage, case: caseItem, totalPrice, score, cpuSocket, boardDdr: extractDdrType(board.info || board.specSummary || ""), totalTdp, boardFormFactor: boardFF });
    }
    if (results.length >= 50) break;
  }
  if (!results.length) return null;
  return results.sort((a, b) => (b.score / b.totalPrice) - (a.score / a.totalPrice))[0];
}

/* ==================== AI 기반 budget-set 생성 (gpt-5.4-mini, 주 1회) ==================== */

export async function buildCompatibleSetWithAI(budget, purpose, db) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 미설정");

  const { cpus, gpus, memories, boards, psus, coolers, storages, cases } = await loadParts(db);

  // 브랜드 가중치 로드 (없으면 mallCount만 사용)
  const brandWeightDocs = await db.collection("brand_weights").find().toArray().catch(() => []);
  const brandWeightMap = Object.fromEntries(brandWeightDocs.map((d) => [d.category, d.weights || {}]));

  const fmtCpu = (p) => `${p.name} | ${p.price.toLocaleString()}원 | 소켓:${extractCpuSocket(p)} | TDP:${extractTdp(p.info || "")}W`;
  const fmtGpu = (p) => `${p.name} | ${p.price.toLocaleString()}원 | TDP:${extractTdp(p.info || "")}W`;
  const fmtBoard = (p) => `${p.name} | ${p.price.toLocaleString()}원 | 소켓:${extractBoardSocket(p)}`;
  const fmtMem = (p) => `${p.name} | ${p.price.toLocaleString()}원 | ${extractMemoryCapacity(p)}GB`;
  const fmtSimple = (p) => `${p.name} | ${p.price.toLocaleString()}원`;

  // CPU/GPU: 벤치마크 점수 기준 상위 후보 (기존 유지)
  const sortedCpus = [...cpus].filter(p => p.price > 0 && p.price <= budget).sort((a, b) => getCpuScore(b) - getCpuScore(a)).slice(0, 40);
  const sortedGpus = [...gpus].filter(p => p.price > 0 && p.price <= budget * 0.60).sort((a, b) => getGpuScore(b) - getGpuScore(a)).slice(0, 30);

  // 보조 부품: mallCount + DataLab 브랜드 가중치 합산 인기도 점수 기준 상위 10개
  // 메인보드는 소켓 다양성 확보를 위해 AMD 5개 + Intel 5개로 분리
  const boardBudget = Math.max(budget * 0.10, 80000);
  const boardsFiltered = [...boards].filter(p => p.price > 0 && p.price <= boardBudget * 1.5);
  const amdBoards = boardsFiltered.filter(b => /am[45]|b[45][56][05]|x[45][67][05]|a[46][25]0/i.test(b.name))
    .sort((a, b) => getPopularityScore(b, "motherboard", brandWeightMap) - getPopularityScore(a, "motherboard", brandWeightMap)).slice(0, 5);
  const intelBoards = boardsFiltered.filter(b => /lga|z[67][89]0|b[78][56]0|h[78][17]0|z[45]90|b[45][56]0/i.test(b.name))
    .sort((a, b) => getPopularityScore(b, "motherboard", brandWeightMap) - getPopularityScore(a, "motherboard", brandWeightMap)).slice(0, 5);
  const sortedBoards = [...new Map([...amdBoards, ...intelBoards].map(p => [p._id.toString(), p])).values()];

  // 메모리: DDR4 5개 + DDR5 5개로 분리
  const memBudget = Math.max(budget * 0.08, 55000);
  const memsFiltered = [...memories].filter(p => p.price > 0 && p.price <= memBudget * 2.0);
  const ddr4Mems = memsFiltered.filter(m => /ddr4/i.test(m.name))
    .sort((a, b) => getPopularityScore(b, "memory", brandWeightMap) - getPopularityScore(a, "memory", brandWeightMap)).slice(0, 5);
  const ddr5Mems = memsFiltered.filter(m => /ddr5/i.test(m.name))
    .sort((a, b) => getPopularityScore(b, "memory", brandWeightMap) - getPopularityScore(a, "memory", brandWeightMap)).slice(0, 5);
  const sortedMems = [...new Map([...ddr4Mems, ...ddr5Mems].map(p => [p._id.toString(), p])).values()];

  const sortByPopularity = (arr, category, priceCap) =>
    arr.filter(p => p.price > 0 && p.price <= priceCap)
      .sort((a, b) => getPopularityScore(b, category, brandWeightMap) - getPopularityScore(a, category, brandWeightMap))
      .slice(0, 10);

  const sortedPsus = sortByPopularity(psus, "psu", Math.max(budget * 0.08, 55000));
  const sortedCoolers = sortByPopularity(coolers, "cooler", Math.max(budget * 0.05, 35000));
  const sortedStorages = sortByPopularity(storages, "storage", Math.max(budget * 0.08, 60000));
  const sortedCases = sortByPopularity(cases, "case", Math.max(budget * 0.07, 50000));

  const userPrompt = [
    `총 예산: ${budget.toLocaleString()}원 (8개 부품 합계가 반드시 ${Math.round(budget * 0.9).toLocaleString()}원 ~ ${Math.round(budget * 1.1).toLocaleString()}원 사이여야 함)`,
    `용도: ${purpose}`,
    "",
    "[사용 가능한 부품 목록 — 반드시 이 목록에서만 선택]",
    "",
    "=== CPU ===",
    ...sortedCpus.map(fmtCpu),
    "",
    "=== GPU ===",
    ...sortedGpus.map(fmtGpu),
    "",
    "=== 메인보드 ===",
    ...sortedBoards.map(fmtBoard),
    "",
    "=== 메모리 ===",
    ...sortedMems.map(fmtMem),
    "",
    "=== PSU ===",
    ...sortedPsus.map(fmtSimple),
    "",
    "=== 쿨러 ===",
    ...sortedCoolers.map(fmtSimple),
    "",
    "=== 스토리지 ===",
    ...sortedStorages.map(fmtSimple),
    "",
    "=== 케이스 ===",
    ...sortedCases.map(fmtSimple),
  ].join("\n");

  const messages = [
    { role: "system", content: BUDGET_SET_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const PART_KEYS = ["cpu", "gpu", "motherboard", "memory", "psu", "cooler", "storage", "case"];
  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-5.5",
        response_format: { type: "json_object" },

        messages,
        max_completion_tokens: 4096,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(`OpenAI API 오류 ${resp.status}: ${errBody?.error?.message || ""}`);
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      lastError = new Error("AI 응답 JSON 파싱 실패");
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: '응답이 유효한 JSON이 아닙니다. 반드시 {"parts":{...},"totalPrice":숫자,"summary":"..."} 형식의 순수 JSON만 출력하세요. 마크다운이나 설명 텍스트를 포함하지 마세요.' });
      continue;
    }

    if (!parsed.parts || typeof parsed.parts !== "object") {
      lastError = new Error("AI 응답에 parts 객체가 없음");
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: "응답 형식이 올바르지 않습니다. parts 객체를 포함하여 다시 시도하세요." });
      continue;
    }

    const enrichedParts = {};
    for (const key of PART_KEYS) {
      const p = parsed.parts[key];
      if (p?.name) enrichedParts[key] = { name: p.name, price: p.price || 0, image: null, category: key };
    }

    // GPU는 선택 사항 — cpu/motherboard/memory/psu/storage/case 6개는 필수
    const REQUIRED_KEYS = ["cpu", "motherboard", "memory", "psu", "storage", "case"];
    const missingRequired = REQUIRED_KEYS.filter(k => !enrichedParts[k]);
    if (missingRequired.length > 0) {
      lastError = new Error(`AI가 필수 부품 누락: ${missingRequired.join(", ")}`);
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `다음 필수 부품이 누락되었습니다: ${missingRequired.join(", ")}. GPU는 생략 가능하지만 나머지는 반드시 포함하세요.` });
      continue;
    }

    // DB 실제 가격으로 검증 (AI 환각 방지)
    const partNamesForLookup = Object.values(enrichedParts).map(p => p.name);
    const dbPartsForPrice = await db.collection("parts").find(
      { name: { $in: partNamesForLookup } },
      { projection: { name: 1, price: 1, image: 1 } }
    ).toArray();
    const dbPriceMap = Object.fromEntries(dbPartsForPrice.map(p => [p.name, p]));

    const hallucinated = [];
    for (const key of PART_KEYS) {
      if (!enrichedParts[key]) continue;
      const dbPart = dbPriceMap[enrichedParts[key].name];
      if (dbPart) {
        enrichedParts[key].price = dbPart.price || enrichedParts[key].price;
        enrichedParts[key].image = dbPart.image || null;
      } else {
        hallucinated.push(`${key}: ${enrichedParts[key].name}`);
        delete enrichedParts[key];
      }
    }
    if (hallucinated.length > 0) {
      lastError = new Error(`AI가 DB에 없는 부품 선택: ${hallucinated.join(", ")}`);
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `다음 부품은 DB에 존재하지 않습니다: ${hallucinated.join(", ")}. 반드시 제공된 부품 목록에서 정확한 이름으로만 선택하세요.` });
      continue;
    }

    const totalPrice = Object.values(enrichedParts).reduce((s, p) => s + (p.price || 0), 0);
    const breakdown = Object.entries(enrichedParts)
      .map(([k, v]) => `${k}: ${v.name} (${v.price.toLocaleString()}원)`)
      .join(", ");

    if (totalPrice > budget * 1.10) {
      lastError = new Error(`AI 예산 초과: ${totalPrice.toLocaleString()}원 > 예산 ${budget.toLocaleString()}원의 110%`);
      const over = (totalPrice - Math.round(budget * 1.1)).toLocaleString();
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `현재 구성: ${breakdown}\n총합 ${totalPrice.toLocaleString()}원으로 ${over}원 초과.\n목표: ${Math.round(budget*0.9).toLocaleString()}원~${Math.round(budget*1.1).toLocaleString()}원. 가장 비싼 부품을 저렴한 것으로 교체하거나 GPU를 제외하세요.` });
      continue;
    }
    if (totalPrice < budget * 0.90) {
      lastError = new Error(`AI 예산 미달: ${totalPrice.toLocaleString()}원 < 예산 ${budget.toLocaleString()}원의 90%`);
      const gap = (Math.round(budget * 0.9) - totalPrice).toLocaleString();
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `현재 구성: ${breakdown}\n총합 ${totalPrice.toLocaleString()}원으로 ${gap}원 부족.\n목표: ${Math.round(budget*0.9).toLocaleString()}원~${Math.round(budget*1.1).toLocaleString()}원. GPU 또는 CPU를 더 고사양으로 교체하세요.` });
      continue;
    }

    return {
      budget,
      purpose,
      totalPrice,
      computedAt: new Date().toISOString(),
      parts: enrichedParts,
      summary: parsed.summary || "",
    };
  }

  throw lastError || new Error(`${MAX_ATTEMPTS}회 시도 후 예산 범위 미충족`);
}

export async function saveBudgetSetToDb(db, budget, purpose, result) {
  const _id = `budget-set:${budget}:${purpose}`;
  await db.collection("cached_sets").replaceOne({ _id }, { _id, budget, purpose, result, computedAt: new Date() }, { upsert: true });
}

/* ==================== V2: 보조부품 인기순 자동선정 + AI CPU/GPU 최적화 ==================== */

const BUDGET_SET_V2_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function buildCompatibleSetWithAIV2(budget, db) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 미설정");

  const { cpus, gpus, memories, boards, psus, coolers, storages, cases } = await loadParts(db);

  const brandWeightDocs = await db.collection("brand_weights").find().toArray().catch(() => []);
  const brandWeightMap = Object.fromEntries(brandWeightDocs.map((d) => [d.category, d.weights || {}]));

  const minBudget = budget;
  const maxBudget = budget + 100000;
  const lowBudget = budget < 700000;

  // ─── Phase 1: 보조 부품 인기순(mallCount) 자동 선정 (AI 없이) ──────────────
  const popularFirst = (arr, category, priceCap) =>
    [...arr]
      .filter(p => p.price > 0 && p.price <= priceCap)
      .sort((a, b) => getPopularityScore(b, category, brandWeightMap) - getPopularityScore(a, category, brandWeightMap));

  const storageCap = Math.max(budget * (lowBudget ? 0.13 : 0.10), 60000);
  const psuCap    = Math.max(budget * (lowBudget ? 0.13 : 0.10), 55000);
  const caseCap   = Math.max(budget * (lowBudget ? 0.11 : 0.08), 45000);
  const coolerCap = Math.max(budget * (lowBudget ? 0.09 : 0.06), 25000);

  const preStorage = popularFirst(storages, "storage", storageCap)[0];
  const prePsu     = popularFirst(psus, "psu", psuCap)[0];
  const preCase    = popularFirst(cases, "case", caseCap)[0];
  const preCooler  = popularFirst(coolers, "cooler", coolerCap)[0];

  if (!preStorage || !prePsu || !preCase || !preCooler)
    throw new Error("필수 보조 부품(PSU/저장장치/케이스/쿨러)을 찾을 수 없음");

  const secondaryTotal = preStorage.price + prePsu.price + preCase.price + preCooler.price;
  const remainingBudget = budget - secondaryTotal;

  // ─── Phase 2: CPU 후보별 호환 메인보드+메모리 인기순 자동 선정 ────────────
  const boardCap = Math.max(remainingBudget * 0.24, 80000);
  const memCap   = Math.max(remainingBudget * 0.18, 55000);

  const sortedCpus = [...cpus]
    .filter(p => p.price > 0 && getCpuScore(p) > 0 && p.price <= remainingBudget * 0.55)
    .sort((a, b) => (getCpuScore(b) / b.price) - (getCpuScore(a) / a.price))
    .slice(0, 10);

  if (sortedCpus.length < 5) {
    const extra = [...cpus]
      .filter(p => p.price > 0 && getCpuScore(p) === 0 && p.price <= remainingBudget * 0.5)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5);
    sortedCpus.push(...extra);
  }

  const cpuCombos = [];
  for (const cpu of sortedCpus) {
    const socket = extractCpuSocket(cpu);
    const board = popularFirst(boards, "motherboard", boardCap)
      .find(b => isSocketCompatible(socket, extractBoardSocket(b)));
    if (!board) continue;

    const mem = popularFirst(memories, "memory", memCap)
      .find(m => isMemoryCompatible(m, board));
    if (!mem) continue;

    cpuCombos.push({ cpu, board, mem, comboPrice: cpu.price + board.price + mem.price });
    if (cpuCombos.length >= 5) break;
  }

  if (cpuCombos.length === 0) throw new Error("호환되는 CPU+메인보드+메모리 조합을 찾을 수 없음");

  // ─── Phase 3: GPU 후보 (가성비순 + 벤치 없는 GPU 가격순 보완) ─────────────
  const scoredGpus = [...gpus]
    .filter(p => p.price > 0 && getGpuScore(p) > 0)
    .sort((a, b) => (getGpuScore(b) / b.price) - (getGpuScore(a) / a.price))
    .slice(0, 10);
  const unscoredGpus = [...gpus]
    .filter(p => p.price > 0 && getGpuScore(p) === 0)
    .sort((a, b) => b.price - a.price)
    .slice(0, 8);
  const gpuCandidates = [...scoredGpus, ...unscoredGpus];

  // ─── Phase 4: AI에게 CPU 조합 + GPU 선택만 요청 (소형 프롬프트) ───────────
  const systemPrompt = `PC 견적 전문가입니다. 아래 조합 중 예산에 최적인 것을 선택하세요.
JSON만 출력: {"comboIndex":숫자(0-based),"gpuName":"정확한GPU이름 또는 null","summary":"30자 이내 한줄요약"}
규칙:
- 총합(고정합계+조합가격+GPU가격)이 반드시 ${minBudget.toLocaleString()}원 이상 ${maxBudget.toLocaleString()}원 미만
- GPU 추가 시 초과되면 gpuName을 null로 설정`;

  const comboLines = cpuCombos.map((c, i) =>
    `조합${i}: ${c.cpu.name}(${c.cpu.price.toLocaleString()})+${c.board.name}(${c.board.price.toLocaleString()})+${c.mem.name}(${c.mem.price.toLocaleString()})=합계${c.comboPrice.toLocaleString()}원 [GPU가용:${(remainingBudget - c.comboPrice).toLocaleString()}원]`
  ).join("\n");

  const gpuLines = gpuCandidates.slice(0, 10).map(g => `${g.name}(${g.price.toLocaleString()}원)`).join(" / ");

  const userPrompt = [
    `총예산:${budget.toLocaleString()}원 | 고정부품:${secondaryTotal.toLocaleString()}원`,
    `(저장장치=${preStorage.name} ${preStorage.price.toLocaleString()}원, 파워=${prePsu.name} ${prePsu.price.toLocaleString()}원, 케이스=${preCase.name} ${preCase.price.toLocaleString()}원, 쿨러=${preCooler.name} ${preCooler.price.toLocaleString()}원)`,
    "", "[CPU+메인보드+메모리 조합]", comboLines,
    "", "[GPU 후보(가성비순)]", gpuLines,
  ].join("\n");

  let parsed = null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-5.5",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 1500,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      parsed = JSON.parse(fenceMatch ? fenceMatch[1].trim() : raw.trim());
    } else {
      const errBody = await resp.json().catch(() => ({}));
      logger.warn(`OpenAI API 오류 ${resp.status}: ${errBody?.error?.message || ""} — fallback 사용`);
    }
  } catch (e) {
    logger.warn(`AI 호출 실패(${e.message}), 알고리즘 fallback 사용 (예산: ${budget.toLocaleString()}원)`);
  }

  // ─── Phase 5: AI 결과 적용 + 알고리즘 fallback ────────────────────────────
  // fallback: 예산의 ~40%에 가장 가까운 조합 선택 (예산 비례)
  const targetComboPrice = remainingBudget * 0.40;
  const fallbackIndex = cpuCombos.reduce((bestIdx, combo, i) => {
    const diff = Math.abs(combo.comboPrice - targetComboPrice);
    const bestDiff = Math.abs(cpuCombos[bestIdx].comboPrice - targetComboPrice);
    return diff < bestDiff ? i : bestIdx;
  }, 0);

  const comboIndex = parsed
    ? Math.min(Math.max(parsed.comboIndex ?? fallbackIndex, 0), cpuCombos.length - 1)
    : fallbackIndex;
  const chosen = cpuCombos[comboIndex];
  const budgetForGpu = remainingBudget - chosen.comboPrice;

  let chosenGpu = null;
  if (parsed?.gpuName && parsed.gpuName !== "null") {
    chosenGpu = gpuCandidates.find(g => g.name === parsed.gpuName) || null;
  }
  // GPU 미선택 또는 이름 매칭 실패 시 예산 내 가장 비싼 GPU 선정 (가격 내림차순 = 최고성능)
  if (!chosenGpu && budgetForGpu >= 80000) {
    chosenGpu = gpuCandidates
      .filter(g => g.price <= budgetForGpu && secondaryTotal + chosen.comboPrice + g.price < maxBudget)
      .sort((a, b) => b.price - a.price)[0] || null;
  }
  // 총합 상한 초과 시 더 저렴한 GPU 탐색
  if (chosenGpu && secondaryTotal + chosen.comboPrice + chosenGpu.price >= maxBudget) {
    const cheaper = gpuCandidates
      .filter(g => g.price > 0 && secondaryTotal + chosen.comboPrice + g.price < maxBudget)
      .sort((a, b) => b.price - a.price)[0];
    chosenGpu = cheaper || null;
  }
  // 총합 하한 미달 시 더 비싼 GPU로 업그레이드
  const preTotal = secondaryTotal + chosen.comboPrice + (chosenGpu?.price || 0);
  if (preTotal < minBudget && budgetForGpu >= 80000) {
    const betterGpu = gpuCandidates
      .filter(g => g.price <= budgetForGpu
        && secondaryTotal + chosen.comboPrice + g.price >= minBudget
        && secondaryTotal + chosen.comboPrice + g.price < maxBudget)
      .sort((a, b) => b.price - a.price)[0];
    if (betterGpu) chosenGpu = betterGpu;
  }

  const parts = {
    cpu:         { name: chosen.cpu.name,   price: chosen.cpu.price,   image: chosen.cpu.image || null,   category: "cpu" },
    motherboard: { name: chosen.board.name, price: chosen.board.price, image: chosen.board.image || null, category: "motherboard" },
    memory:      { name: chosen.mem.name,   price: chosen.mem.price,   image: chosen.mem.image || null,   category: "memory" },
    storage:     { name: preStorage.name,   price: preStorage.price,   image: preStorage.image || null,   category: "storage" },
    psu:         { name: prePsu.name,       price: prePsu.price,       image: prePsu.image || null,       category: "psu" },
    cooler:      { name: preCooler.name,    price: preCooler.price,    image: preCooler.image || null,    category: "cooler" },
    case:        { name: preCase.name,      price: preCase.price,      image: preCase.image || null,      category: "case" },
  };
  if (chosenGpu) {
    parts.gpu = { name: chosenGpu.name, price: chosenGpu.price, image: chosenGpu.image || null, category: "gpu" };
  }

  const finalTotal = Object.values(parts).reduce((s, p) => s + (p?.price || 0), 0);

  return {
    budget,
    totalPrice: finalTotal,
    computedAt: new Date().toISOString(),
    parts,
    summary: parsed?.summary || `${budget.toLocaleString()}원 최적 가성비 PC`,
    compatibilityVerified: true,
  };
}

async function saveBudgetSetV2ToDb(db, budget, result) {
  const _id = `budget-set-v2:${budget}`;
  await db.collection("cached_sets_v2").replaceOne({ _id }, { _id, budget, result, computedAt: new Date() }, { upsert: true });
}

function checkAdminKey(req, res) {
  const key = req.headers["authorization"]?.replace("Bearer ", "");
  if (!config.adminApiKey || key !== config.adminApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* ==================== 호환 세트 엔드포인트 ==================== */

router.get("/budget-set", async (req, res) => {
  const VALID_PURPOSES = ["게임용", "작업용", "사무용"];
  const budget = Math.max(300000, Math.min(10000000, Number(req.query.budget) || 1500000));
  const purpose = VALID_PURPOSES.includes(req.query.purpose) ? req.query.purpose : "게임용";

  const memKey = `recommend:budget-set:${budget}:${purpose}`;
  const memHit = getCache(memKey);
  if (memHit?.parts) return res.json(memHit);

  const db = getDB();
  if (!db) return res.status(500).json({ error: "DATABASE_ERROR", message: "DB 연결 실패" });

  try {
    const doc = await db.collection("cached_sets").findOne({ _id: `budget-set:${budget}:${purpose}` });

    if (doc) {
      const result = doc.result;
      if (!result?.parts) {
        logger.warn(`budget-set 무효 문서 감지 — 삭제 후 재계산`);
        await db.collection("cached_sets").deleteOne({ _id: `budget-set:${budget}:${purpose}` });
      } else {
        const age = Date.now() - new Date(doc.computedAt).getTime();
        setCache(memKey, result, 10 * 60 * 1000);
        if (age > BUDGET_SET_TTL_MS) {
          const bgKey = `${budget}:${purpose}`;
          if (!buildingInProgress.has(bgKey)) {
            buildingInProgress.add(bgKey);
            logger.info(`budget-set stale (${Math.round(age / 86400000)}d) — AI 백그라운드 갱신`);
            buildCompatibleSetWithAI(budget, purpose, db)
              .then(async (fresh) => {
                if (!fresh?.parts) return;
                await saveBudgetSetToDb(db, budget, purpose, fresh);
                setCache(memKey, fresh, 10 * 60 * 1000);
              })
              .catch(e => logger.error(`budget-set AI 백그라운드 갱신 실패: ${e.message}`))
              .finally(() => buildingInProgress.delete(bgKey));
          }
        }
        return res.json(result);
      }
    }

    const bgKey = `${budget}:${purpose}`;
    if (!buildingInProgress.has(bgKey)) {
      buildingInProgress.add(bgKey);
      buildCompatibleSetWithAI(budget, purpose, db)
        .then(async (result) => {
          if (!result?.parts) return;
          await saveBudgetSetToDb(db, budget, purpose, result);
          setCache(memKey, result, 10 * 60 * 1000);
        })
        .catch(e => logger.error(`budget-set AI 초기 계산 실패: ${e.message}`))
        .finally(() => buildingInProgress.delete(bgKey));
    }

    return res.status(503).json({
      error: "NOT_READY",
      message: "호환 세트를 준비 중입니다. 잠시 후 다시 시도해주세요.",
      retryAfter: 60,
    });
  } catch (err) {
    logger.error(`budget-set 오류: ${err.message}`);
    res.status(500).json({ error: "추천 생성 실패" });
  }
});

router.post("/budget-set/refresh", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const db = getDB();
  if (!db) return res.status(500).json({ error: "DB 연결 실패" });

  const budget = parseInt(req.body?.budget) || 1500000;
  const purpose = req.body?.purpose || "게임용";

  try {
    logger.info(`budget-set AI 갱신 시작: ${budget.toLocaleString()}원 / ${purpose}`);
    const result = await buildCompatibleSetWithAI(budget, purpose, db);
    await saveBudgetSetToDb(db, budget, purpose, result);
    const memKey = `recommend:budget-set:${budget}:${purpose}`;
    setCache(memKey, result, 10 * 60 * 1000);
    res.json({ status: "ok", budget, purpose, totalPrice: result.totalPrice, summary: result.summary });
  } catch (e) {
    logger.error(`budget-set AI 갱신 실패 ${budget}/${purpose}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// 3 purposes × 26 budgets = 78 AI 호출 (주 1회 GitHub Actions)
router.post("/budget-set/refresh-all", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const purposes = CACHED_PURPOSES;
  const budgets = Array.from({ length: 26 }, (_, i) => 500000 + i * 100000);
  res.json({ status: "started", total: budgets.length * purposes.length, purposes });

  (async () => {
    const db = getDB();
    if (!db) return;
    let success = 0, fail = 0;
    for (const purpose of purposes) {
      for (const budget of budgets) {
        try {
          const result = await buildCompatibleSetWithAI(budget, purpose, db);
          await saveBudgetSetToDb(db, budget, purpose, result);
          const memKey = `recommend:budget-set:${budget}:${purpose}`;
          setCache(memKey, result, 10 * 60 * 1000);
          logger.info(`budget-set AI 완료: ${budget.toLocaleString()}원 / ${purpose} → ${result.totalPrice?.toLocaleString()}원`);
          success++;
        } catch (err) {
          logger.error(`budget-set AI 실패: ${budget.toLocaleString()}원 / ${purpose} — ${err.message}`);
          fail++;
        }
        await sleep(2000);
      }
    }
    logger.info(`budget-set refresh-all 완료: 성공 ${success}개, 실패 ${fail}개`);
  })();
});

/* ==================== AI 견적 추천 (캐시 우선, fallback: 코드 알고리즘) ==================== */

router.post("/", validate(recommendSchema), async (req, res) => {
  try {
    const { budget, purpose } = req.body;
    logger.info(`추천 요청: 예산 ${budget.toLocaleString()}원, 용도: ${purpose}`);
    const db = getDB();
    if (!db) return res.status(500).json({ error: "DATABASE_ERROR", message: "데이터베이스 연결에 실패했습니다." });

    // 1. DB 캐시 조회 (게임용/작업용, 100k 단위 반올림, 500k~3000k)
    if (CACHED_PURPOSES.includes(purpose)) {
      const { cached, clampedBudget } = await getCachedBudgetSet(db, budget, purpose);
      if (cached?.parts) {
        logger.info(`추천 캐시 히트: ${clampedBudget.toLocaleString()}원 / ${purpose}`);
        return res.json({
          builds: [{
            label: "AI 추천",
            totalPrice: cached.totalPrice,
            parts: cached.parts,
            summary: cached.summary,
            aiEvaluation: cached.summary || "",
            aiStrengths: [],
            aiRecommendations: [],
          }],
          recommended: "AI 추천",
          message: `${purpose} 용도로 ${clampedBudget.toLocaleString()}원 AI 추천 견적입니다.`,
          reasons: [`${purpose} 용도에 최적화`, `예산 ${budget.toLocaleString()}원`, "AI 사전 생성 견적"],
        });
      }
      logger.info(`추천 캐시 미스: ${clampedBudget.toLocaleString()}원 / ${purpose} — 코드 알고리즘 fallback`);
    }

    // 2. fallback: 코드 기반 알고리즘
    const { cpus, gpus, memories, boards, psus, coolers, storages, cases } = await loadParts(db);
    const weights = {
      "사무용": { cpu: 0.4, gpu: 0.2, cpuBR: 0.25, gpuBR: 0.15 },
      "게임용": { cpu: 0.45, gpu: 0.6, cpuBR: 0.30, gpuBR: 0.40 },
      "작업용": { cpu: 0.5, gpu: 0.4, cpuBR: 0.30, gpuBR: 0.25 },
      "가성비": { cpu: 0.4, gpu: 0.5, cpuBR: 0.25, gpuBR: 0.30 },
    };
    const w = weights[purpose] || weights["가성비"];
    const minB = budget * 0.90, maxB = budget * 1.10;
    const maxCpu = budget * w.cpuBR, idealCpu = maxCpu * 0.7;
    const maxGpu = budget * w.gpuBR, idealGpu = maxGpu * 0.7;

    let cpuCands = cpus.filter(c => {
      if (purpose === "게임용" && /제온|XEON|EPYC|THREADRIPPER/i.test(c.name || "")) return false;
      return c.price <= maxCpu && extractCpuSocket(c) !== "";
    });
    if (!cpuCands.length) cpuCands = cpus.filter(c => {
      if (purpose === "게임용" && /제온|XEON|EPYC|THREADRIPPER/i.test(c.name || "")) return false;
      return c.price <= maxCpu;
    });
    cpuCands = cpuCands.map(c => {
      const sc = getCpuScore(c);
      const vs = sc > 0 ? (sc / c.price) * w.cpu : 0;
      const bf = 1 / (1 + Math.abs(c.price - idealCpu) / idealCpu);
      return { ...c, _ws: sc > 0 ? vs * 0.6 + bf * 0.4 : bf };
    }).sort((a, b) => b._ws - a._ws).slice(0, 12);

    const gpuCands = gpus.filter(g => getGpuScore(g) > 0 && g.price <= maxGpu).map(g => {
      const vs = (getGpuScore(g) / g.price) * w.gpu;
      const bf = 1 / (1 + Math.abs(g.price - idealGpu) / idealGpu);
      return { ...g, _ws: vs * 0.6 + bf * 0.4 };
    }).sort((a, b) => b._ws - a._ws).slice(0, 12);

    if (!cpuCands.length || !gpuCands.length) {
      return res.status(400).json({
        error: "INSUFFICIENT_CANDIDATES",
        message: !cpuCands.length ? "예산 범위 내의 CPU를 찾을 수 없습니다." : "예산 범위 내의 GPU를 찾을 수 없습니다.",
        debug: { cpuCandidates: cpuCands.length, gpuCandidates: gpuCands.length, budget },
      });
    }

    const results = [];
    const fs = { cpuGpuTooExpensive: 0, bottleneck: 0, remainingTooLow: 0, noSocket: 0, noBoard: 0, noMemory: 0, noPSU: 0, noCooler: 0, noStorage: 0, noCase: 0, budgetRange: 0, success: 0 };

    for (const cpu of cpuCands) {
      for (const gpu of gpuCands) {
        if (results.length >= 50) break;
        if (!checkBottleneck(getCpuScore(cpu), getGpuScore(gpu), purpose, budget)) { fs.bottleneck++; continue; }
        const cgCost = cpu.price + gpu.price;
        const rem = budget - cgCost;
        if (cgCost > budget * 0.70) { fs.cpuGpuTooExpensive++; continue; }
        if (rem < 150000) { fs.remainingTooLow++; continue; }
        const cpuSocket = extractCpuSocket(cpu);
        if (!cpuSocket) { fs.noSocket++; continue; }

        const bBd = rem * 0.20, mBd = rem * 0.15, pBd = rem * 0.12, cBd = rem * 0.08, sBd = rem * 0.25, caBd = rem * 0.20;

        const bds = boards.filter(b => isSocketCompatible(cpuSocket, extractBoardSocket(b)) && b.price <= bBd * 1.5 && b.price >= 30000);
        if (!bds.length) { fs.noBoard++; continue; }
        const board = bds.sort((a, b) => Math.abs(a.price - bBd) - Math.abs(b.price - bBd))[0];
        const boardFF = extractBoardFormFactor(board);

        let capReq = purpose === "작업용" ? 32 : 16;
        let mems = memories.filter(m => isMemoryCompatible(m, board) && extractMemoryCapacity(m) >= capReq && m.price <= mBd * 2.0 && m.price >= 30000);
        if (!mems.length && purpose === "작업용") mems = memories.filter(m => isMemoryCompatible(m, board) && extractMemoryCapacity(m) >= 16 && m.price <= mBd * 2.5 && m.price >= 30000);
        if (!mems.length) {
          const bDdr = extractDdrType(board.info || board.specSummary || "");
          mems = memories.filter(m => {
            const md = extractDdrType(m.name || m.info || "");
            if (bDdr && md && bDdr !== md) return false;
            return extractMemoryCapacity(m) >= Math.max(8, capReq * 0.5) && m.price <= mBd * 3.0 && m.price >= 30000;
          });
        }
        if (!mems.length) { fs.noMemory++; continue; }
        const memory = mems.sort((a, b) => {
          const ac = extractMemoryCapacity(a), bc = extractMemoryCapacity(b);
          return ac !== bc ? bc - ac : Math.abs(a.price - mBd) - Math.abs(b.price - mBd);
        })[0];

        const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
        const gpuTdp = extractTdp(gpu.info || "");
        const totalTdp = cpuTdp + gpuTdp + 100;

        const psusF = psus.filter(p => extractTdp(p.name || p.info || "") >= totalTdp * 1.2 && p.price <= pBd * 1.5 && p.price >= 40000);
        if (!psusF.length) { fs.noPSU++; continue; }
        const psu = psusF.sort((a, b) => Math.abs(a.price - pBd) - Math.abs(b.price - pBd))[0];

        const coolersF = coolers.filter(c => isCoolerCompatible(c, cpuSocket, cpuTdp) && c.price <= cBd * 1.5 && c.price >= 15000);
        if (!coolersF.length) { fs.noCooler++; continue; }
        const cooler = coolersF.sort((a, b) => {
          const as = parseCoolerSpecs(a), bs = parseCoolerSpecs(b);
          if (cpuTdp > 0 && as.tdpW > 0 && bs.tdpW > 0) { const am = as.tdpW - cpuTdp, bm = bs.tdpW - cpuTdp; if (Math.abs(am - bm) > 20) return bm - am; }
          return Math.abs(a.price - cBd) - Math.abs(b.price - cBd);
        })[0];

        const remAfterCooler = rem - board.price - memory.price - psu.price - cooler.price;
        const stors = storages.filter(s => s.price <= Math.min(sBd * 1.2, remAfterCooler * 0.6) && s.price >= 50000);
        if (!stors.length) { fs.noStorage++; continue; }
        const storage = stors.sort((a, b) => Math.abs(a.price - sBd) - Math.abs(b.price - sBd))[0];

        const remAfterStorage = remAfterCooler - storage.price;
        const adjCaseBudget = Math.max(remAfterStorage, 30000);
        const casesF = cases.filter(c => isCaseCompatible(c, boardFF) && c.price <= adjCaseBudget && c.price >= 30000);
        if (!casesF.length) { fs.noCase++; continue; }
        const caseItem = casesF.sort((a, b) => Math.abs(a.price - Math.min(adjCaseBudget * 0.8, caBd)) - Math.abs(b.price - Math.min(adjCaseBudget * 0.8, caBd)))[0];

        const totalPrice = cpu.price + gpu.price + memory.price + board.price + psu.price + cooler.price + storage.price + caseItem.price;
        if (totalPrice < minB || totalPrice > maxB) { fs.budgetRange++; continue; }
        fs.success++;
        const score = getCpuScore(cpu) * w.cpu + getGpuScore(gpu) * w.gpu;
        results.push({ cpu, gpu, memory, board, psu, cooler, storage, case: caseItem, totalPrice, score, cpuSocket, boardDdr: extractDdrType(board.info || board.specSummary || ""), totalTdp, boardFormFactor: boardFF });
      }
      if (results.length >= 50) break;
    }

    logger.info(`조합 생성 완료: ${results.length}개, 통계: ${JSON.stringify(fs)}`);
    if (!results.length) return res.status(400).json({ error: "NO_VALID_COMBINATIONS", message: "예산에 맞는 조합을 찾을 수 없습니다.", debug: { budget, purpose, filterStats: fs } });

    results.sort((a, b) => b.score - a.score);
    const builds = [];
    const ce = results.slice().sort((a, b) => (b.score / b.totalPrice) - (a.score / a.totalPrice))[0];
    builds.push({ label: "가성비", ...ce });
    const bal = results.slice().sort((a, b) => Math.abs(a.totalPrice - budget) - Math.abs(b.totalPrice - budget))[0];
    if (bal !== ce) builds.push({ label: "균형", ...bal });
    const hp = results[0];
    if (hp !== ce && hp !== bal) builds.push({ label: "고성능", ...hp });

    const uniqueBuilds = Array.from(new Set(builds.map(b => `${b.cpu.name}|${b.gpu.name}`))).map(k => builds.find(b => `${b.cpu.name}|${b.gpu.name}` === k));
    while (uniqueBuilds.length < 3 && uniqueBuilds.length < results.length) {
      const next = results.find(r => !uniqueBuilds.some(b => b.cpu.name === r.cpu.name && b.gpu.name === r.gpu.name));
      if (next) uniqueBuilds.push({ label: uniqueBuilds.length === 1 ? "균형" : "고성능", ...next }); else break;
    }

    const buildsFormatted = uniqueBuilds.map((b) => ({
      label: b.label,
      totalPrice: b.totalPrice,
      score: Math.round(b.score),
      parts: { cpu: { name: b.cpu.name, price: b.cpu.price, image: b.cpu.image }, gpu: { name: b.gpu.name, price: b.gpu.price, image: b.gpu.image }, memory: { name: b.memory.name, price: b.memory.price, image: b.memory.image }, motherboard: { name: b.board.name, price: b.board.price, image: b.board.image }, psu: { name: b.psu.name, price: b.psu.price, image: b.psu.image }, cooler: { name: b.cooler.name, price: b.cooler.price, image: b.cooler.image }, storage: { name: b.storage.name, price: b.storage.price, image: b.storage.image }, case: { name: b.case.name, price: b.case.price, image: b.case.image } },
      compatibility: { socket: `${b.cpuSocket} ↔ ${extractBoardSocket(b.board)}`, ddr: `${b.boardDdr} ↔ ${extractDdrType(b.memory.name)}`, power: `${b.totalTdp}W → ${extractTdp(b.psu.name)}W`, formFactor: `${b.boardFormFactor} ↔ ${b.case.specs?.formFactor?.join("/") || "ATX"}` },
      aiEvaluation: "",
      aiStrengths: [],
      aiRecommendations: [],
    }));

    res.json({ builds: buildsFormatted, recommended: uniqueBuilds[1]?.label || uniqueBuilds[0]?.label, message: `${purpose} 용도로 ${uniqueBuilds.length}가지 조합을 추천합니다!`, reasons: [`${purpose} 용도에 최적화`, `예산 ${budget.toLocaleString()}원`, `${results.length}개 조합 중 최적`] });
  } catch (error) {
    logger.error(`추천 오류: ${error.message}`);
    const isProd = process.env.NODE_ENV === "production";
    res.status(500).json({ error: "RECOMMENDATION_ERROR", message: isProd ? "추천 생성 중 오류가 발생했습니다." : error.message });
  }
});

/* ==================== V2 엔드포인트 ==================== */

// GET /api/recommend/budget-set-v2?budget=1500000
router.get("/budget-set-v2", validate(recommendV2Schema, "query"), async (req, res) => {
  const budget = Number(req.query.budget);
  const memKey = `recommend:budget-set-v2:${budget}`;
  const memHit = getCache(memKey);
  if (memHit?.parts) return res.json(memHit);

  const db = getDB();
  if (!db) return res.status(500).json({ error: "DATABASE_ERROR", message: "DB 연결 실패" });

  try {
    const doc = await db.collection("cached_sets_v2").findOne({ _id: `budget-set-v2:${budget}` });

    if (doc?.result?.parts) {
      // 호환성 검증 없이 생성된 구버전 캐시는 즉시 재빌드
      if (!doc.result.compatibilityVerified && !buildingInProgressV2.has(budget)) {
        buildingInProgressV2.add(budget);
        logger.info(`budget-set-v2 호환성 미검증 캐시 — 즉시 재빌드: ${budget}`);
        buildCompatibleSetWithAIV2(budget, db)
          .then(async (fresh) => {
            if (!fresh?.parts) return;
            await saveBudgetSetV2ToDb(db, budget, fresh);
            setCache(memKey, fresh, 10 * 60 * 1000);
          })
          .catch(e => logger.error(`budget-set-v2 재빌드 실패: ${e.message}`))
          .finally(() => buildingInProgressV2.delete(budget));
        return res.status(503).json({ error: "NOT_READY", message: "호환 세트를 재검증 중입니다. 잠시 후 다시 시도해주세요.", retryAfter: 60 });
      }
      const age = Date.now() - new Date(doc.computedAt).getTime();
      setCache(memKey, doc.result, 10 * 60 * 1000);
      if (age > BUDGET_SET_V2_TTL_MS && !buildingInProgressV2.has(budget)) {
        buildingInProgressV2.add(budget);
        logger.info(`budget-set-v2 stale (${Math.round(age / 86400000)}d) — 백그라운드 갱신`);
        buildCompatibleSetWithAIV2(budget, db)
          .then(async (fresh) => {
            if (!fresh?.parts) return;
            await saveBudgetSetV2ToDb(db, budget, fresh);
            setCache(memKey, fresh, 10 * 60 * 1000);
          })
          .catch(e => logger.error(`budget-set-v2 백그라운드 갱신 실패: ${e.message}`))
          .finally(() => buildingInProgressV2.delete(budget));
      }
      return res.json(doc.result);
    }

    if (!buildingInProgressV2.has(budget)) {
      buildingInProgressV2.add(budget);
      buildCompatibleSetWithAIV2(budget, db)
        .then(async (result) => {
          if (!result?.parts) return;
          await saveBudgetSetV2ToDb(db, budget, result);
          setCache(memKey, result, 10 * 60 * 1000);
        })
        .catch(e => logger.error(`budget-set-v2 초기 계산 실패: ${e.message}`))
        .finally(() => buildingInProgressV2.delete(budget));
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
  try {
    logger.info(`budget-set-v2 갱신 시작: ${budget.toLocaleString()}원`);
    const result = await buildCompatibleSetWithAIV2(budget, db);
    await saveBudgetSetV2ToDb(db, budget, result);
    setCache(`recommend:budget-set-v2:${budget}`, result, 10 * 60 * 1000);
    res.json({ status: "ok", budget, totalPrice: result.totalPrice, summary: result.summary });
  } catch (e) {
    logger.error(`budget-set-v2 갱신 실패 ${budget}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// 26 budgets (500k~3000k, 100k 단위) — 주 1회 GitHub Actions
router.post("/budget-set-v2/refresh-all", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const budgets = Array.from({ length: 26 }, (_, i) => 500000 + i * 100000);
  res.json({ status: "started", total: budgets.length });

  (async () => {
    const db = getDB();
    if (!db) return;
    let success = 0, fail = 0;
    for (const budget of budgets) {
      try {
        const result = await buildCompatibleSetWithAIV2(budget, db);
        await saveBudgetSetV2ToDb(db, budget, result);
        setCache(`recommend:budget-set-v2:${budget}`, result, 10 * 60 * 1000);
        logger.info(`budget-set-v2 완료: ${budget.toLocaleString()}원 → ${result.totalPrice?.toLocaleString()}원`);
        success++;
      } catch (err) {
        logger.error(`budget-set-v2 실패: ${budget.toLocaleString()}원 — ${err.message}`);
        fail++;
      }
      await sleep(2000);
    }
    logger.info(`budget-set-v2 refresh-all 완료: 성공 ${success}개, 실패 ${fail}개`);
  })();
});

router.post("/upgrade", validate(upgradeAdvisorSchema), async (req, res) => {
  const { currentBuild, budget, purpose = "게임용" } = req.body;
  try {
    const db = getDB();
    const [currentCpu, currentGpu] = await Promise.all([findPartForUpgrade(db, "cpu", currentBuild.cpu), findPartForUpgrade(db, "gpu", currentBuild.gpu)]);
    const cpuScore = currentCpu?.benchmarkScore?.passmarkscore || 0;
    const gpuScore = currentGpu?.benchmarkScore?.["3dmarkscore"] || 0;
    logger.info(`업그레이드: CPU="${currentCpu?.name || "미인식"}"(${cpuScore}), GPU="${currentGpu?.name || "미인식"}"(${gpuScore})`);
    const upgradeTargets = resolveUpgradeTargets(purpose, cpuScore, gpuScore, currentBuild);
    const suggestions = (await Promise.all(upgradeTargets.map(async (target) => {
      const sk = target.category === "cpu" ? "benchmarkScore.passmarkscore" : "benchmarkScore.3dmarkscore";
      const cs = target.category === "cpu" ? cpuScore : gpuScore;
      const cid = target.category === "cpu" ? currentCpu?._id : currentGpu?._id;
      const filter = { category: target.category, price: { $gt: 0, $lte: budget } };
      if (cs > 0) filter[sk] = { $gt: cs };
      if (cid) filter._id = { $ne: cid };
      const candidates = await db.collection("parts").find(filter, { projection: { priceHistory: 0 } }).sort({ [sk]: -1 }).limit(3).toArray();
      if (!candidates.length) return null;
      return { category: target.category, reason: target.reason, priority: target.priority, currentName: target.category === "cpu" ? currentCpu?.name : currentGpu?.name, candidates: candidates.map(c => { const ns = target.category === "cpu" ? (c.benchmarkScore?.passmarkscore || 0) : (c.benchmarkScore?.["3dmarkscore"] || 0); return { ...c, _currentScore: cs, _newScore: ns, _improvement: cs > 0 ? Math.round(((ns - cs) / cs) * 100) : null }; }) };
    }))).filter(Boolean);
    res.json({ currentBuild: { cpu: currentCpu?.name || currentBuild.cpu, gpu: currentGpu?.name || currentBuild.gpu }, budget, purpose, cpuScore, gpuScore, suggestions, summary: suggestions.length > 0 ? `${suggestions[0].category.toUpperCase()} 업그레이드를 우선 권장합니다.` : "현재 예산 내에서 유의미한 업그레이드 옵션을 찾지 못했습니다." });
  } catch (err) {
    logger.error(`업그레이드 실패: ${err.message}`);
    res.status(500).json({ error: "업그레이드 분석 실패" });
  }
});

function resolveUpgradeTargets(purpose, cpuScore, gpuScore, currentBuild) {
  const has = (k) => !!currentBuild[k];
  if (purpose === "게임용") return [has("gpu") && { category: "gpu", reason: "게임 성능의 핵심은 GPU입니다.", priority: 1 }, has("cpu") && { category: "cpu", reason: "CPU 병목 해소로 프레임 안정성이 향상됩니다.", priority: 2 }].filter(Boolean);
  if (purpose === "작업용") return [has("cpu") && { category: "cpu", reason: "렌더링·인코딩 등 작업 성능의 핵심은 CPU입니다.", priority: 1 }, has("gpu") && { category: "gpu", reason: "GPU 가속 지원 작업 성능이 향상됩니다.", priority: 2 }].filter(Boolean);
  if (purpose === "사무용") return [has("cpu") && { category: "cpu", reason: "멀티태스킹 성능이 향상됩니다.", priority: 1 }, has("memory") && { category: "memory", reason: "메모리 용량 확장으로 체감 속도가 향상됩니다.", priority: 2 }].filter(Boolean);
  const gpuW = (cpuScore / 15000) > (gpuScore / 8000);
  return [has(gpuW ? "gpu" : "cpu") && { category: gpuW ? "gpu" : "cpu", reason: "현재 구성의 상대적 약점을 보완합니다.", priority: 1 }, has(gpuW ? "cpu" : "gpu") && { category: gpuW ? "cpu" : "gpu", reason: "추가 업그레이드 옵션입니다.", priority: 2 }].filter(Boolean);
}

export default router;
