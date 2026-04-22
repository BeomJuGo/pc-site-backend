// routes/recommend.js - 개선된 추천 알고리즘
import express from "express";
import { getDB } from "../db.js";
import config from "../config.js";
import { loadParts, extractBoardFormFactor, isCaseCompatible } from "../utils/recommend-helpers.js";
import logger from "../utils/logger.js";
import { validate } from "../middleware/validate.js";
import { recommendSchema } from "../schemas/recommend.js";
import { makeAiCacheKey, getOrComputeRecommendation } from "../utils/aiCache.js";
import { upgradeAdvisorSchema } from "../schemas/recommend.js";

const OPENAI_API_KEY = config.openaiApiKey;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const router = express.Router();

/* ==================== 유틸리티 함수 ==================== */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 업그레이드 어드바이저용 퍼지 부품 조회 (부분 이름 허용)
async function findPartForUpgrade(db, category, rawName) {
  if (!rawName) return null;
  const name = rawName.trim();
  const proj = { projection: { name: 1, price: 1, benchmarkScore: 1 } };

  // 1) 완전 일치
  let part = await db.collection("parts").findOne({ category, name }, proj);
  if (part) return part;

  // 2) 앞부분 일치 (사용자가 짧게 입력한 경우: "7500F", "9070")
  const escaped = escapeRegex(name);
  part = await db.collection("parts").findOne(
    { category, name: { $regex: escaped, $options: "i" } },
    proj
  );
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

  let socketMatch = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (socketMatch) return normalizeSocket(socketMatch[1]);

  const socketWithKeyword = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (socketWithKeyword) return normalizeSocket(socketWithKeyword[1]);

  const match = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (match) return normalizeSocket(match[1]);

  if (/AMD|라이젠/i.test(text) && /스레드리퍼|THREADRIPPER/i.test(combined)) {
    if (/PRO|프로/i.test(combined)) {
      if (/9955|9965|9975|9985|9995|시마다|GRANITE/i.test(combined)) return "sWRX9";
      if (/7955|7975|7985|7995|스토름|STORM/i.test(combined)) return "sWRX9";
      if (/5955|5965|5975|5995|샤갈|CHAGALL/i.test(combined)) return "sWRX8";
      if (/3955|3975|3995|캐슬|CASTLE/i.test(combined)) return "sWRX8";
    } else {
      if (/9970|9960|9980|시마다|GRANITE/i.test(combined)) return "sTRX5";
      if (/7970|7960|7980|스토름|STORM/i.test(combined)) return "sTRX5";
      if (/\b(29\d{2}|39\d{2}|49\d{2}|59\d{2})\b/.test(combined)) return "sTRX4";
    }
  }

  if (/인텔|INTEL/i.test(text)) {
    if (/제온|XEON/i.test(combined) && /(w5|w7)[-\s]?\d{4}/i.test(combined)) {
      if (/사파이어|SAPPHIRE|래피드|RAPID/i.test(combined)) return "LGA4677";
    }
    if (/제온|XEON/i.test(combined) && /스케일러블|SCALABLE/i.test(combined)) {
      if (/에메랄드|EMERALD|사파이어|SAPPHIRE|래피드|RAPID/i.test(combined)) return "LGA4677";
      if (/\b(6\d{3}|5\d{3})[A-Z]?\b/.test(combined)) return "LGA4677";
    }
    if (/제온|XEON/i.test(combined) && /E5[-\s]?\d{4}/i.test(combined)) {
      if (/v4|브로드웰|BROADWELL/i.test(combined)) return "LGA2011-3";
      if (/v3|하스웰|HASWELL/i.test(combined)) return "LGA2011-3";
      if (/E5[-\s]?26\d{2}/i.test(combined)) return "LGA2011-3";
    }
    if (/14세대|13세대|12세대|\b(14|13|12)\s*GEN/i.test(combined) ||
      /랙터레이크|RAPTOR|앨더레이크|ALDER/i.test(combined)) return "LGA1700";
    if (/11세대|10세대|\b(11|10)\s*GEN/i.test(combined) ||
      /로켓레이크|ROCKET|코멧레이크|COMET/i.test(combined)) return "LGA1200";
    if (/9세대|8세대|\b(9|8)\s*GEN/i.test(combined) ||
      /커피레이크|COFFEE/i.test(combined)) return "LGA1151";
    const modelMatch = combined.match(/\b(1[0-4]\d{3}[A-Z]*)\b/);
    if (modelMatch) {
      const modelNum = parseInt(modelMatch[1].substring(0, 2));
      if (modelNum >= 12 && modelNum <= 14) return "LGA1700";
      if (modelNum >= 10 && modelNum <= 11) return "LGA1200";
      if (modelNum >= 6 && modelNum <= 9) return "LGA1151";
    }
  }

  return "";
}

function extractBoardSocket(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`;
  const combined = text.toUpperCase();

  let socketMatch = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (socketMatch) return normalizeSocket(socketMatch[1]);

  const socketWithKeyword = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (socketWithKeyword) return normalizeSocket(socketWithKeyword[1]);

  const match = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (match) return normalizeSocket(match[1]);

  if (/B850|X870|A850|B850E|X870E/i.test(combined)) return "AM5";
  if (/AM5|B650|X670|A620|B650E|X670E/i.test(combined)) return "AM5";
  if (/AM4|B550|X570|A520|B450|X470|B350|X370/i.test(combined)) return "AM4";
  if (/sTRX4|TRX40/i.test(combined)) return "sTRX4";
  if (/TR4|X399/i.test(combined)) return "TR4";
  if (/SP3|EPYC/i.test(combined)) return "SP3";
  if (/Z890|B860|H870|LGA\s?1851/i.test(combined)) return "LGA1851";
  if (/Z790|B760|H770|Z690|B660|H610|H670|LGA\s?1700/i.test(combined)) return "LGA1700";
  if (/Z590|B560|H570|Z490|B460|H410|LGA\s?1200/i.test(combined)) return "LGA1200";
  if (/Z390|B360|H370|Z370|B250|H270|Z270|B150|H170|Z170|LGA\s?1151/i.test(combined)) return "LGA1151";
  if (/X299|LGA\s?2066/i.test(combined)) return "LGA2066";
  if (/X99|LGA\s?2011[-\s]?(?:3|V3)/i.test(combined)) return "LGA2011-3";
  if (/X79|LGA\s?2011/i.test(combined)) return "LGA2011";
  if (/X58|LGA\s?1366/i.test(combined)) return "LGA1366";
  if (/Z97|H97|Z87|H87|B85|H81|LGA\s?1150/i.test(combined)) return "LGA1150";
  if (/Z77|H77|Z68|P67|H67|B75|LGA\s?1155/i.test(combined)) return "LGA1155";
  if (/P45|P35|G41|LGA\s?775/i.test(combined)) return "LGA775";

  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `LGA${lga[1]}`;

  return "";
}

function isSocketCompatible(cpuSocket, boardSocket) {
  if (!cpuSocket || !boardSocket) return false;
  return normalizeSocket(cpuSocket) === normalizeSocket(boardSocket);
}

function extractDdrType(text = "") {
  const match = text.toUpperCase().match(/DDR([45])/);
  return match ? `DDR${match[1]}` : "";
}

function extractMemorySpeed(text = "") {
  const patterns = [
    /(\d{4,5})\s*MHz/i,
    /DDR[45][-\s]?(\d{4,5})/i,
    /(\d{4,5})\s*MT\/S/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const speed = parseInt(match[1]);
      if (speed >= 1600 && speed <= 10000) return speed;
    }
  }
  return 0;
}

function extractBoardMemorySpeedRange(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`.toUpperCase();
  const boardSocket = extractBoardSocket(board);
  const boardDdr = extractDdrType(text);

  if (boardDdr === "DDR5") {
    if (boardSocket === "AM5") return { min: 4800, max: 7200 };
    if (boardSocket === "LGA1700") return { min: 4800, max: 8000 };
    if (boardSocket === "LGA1851") return { min: 5600, max: 8000 };
    return { min: 4800, max: 7200 };
  }
  if (boardDdr === "DDR4") {
    if (boardSocket === "AM4") return { min: 2133, max: 5200 };
    if (boardSocket === "LGA1700") return { min: 2133, max: 4800 };
    if (boardSocket === "LGA1200" || boardSocket === "LGA1151") return { min: 2133, max: 4000 };
    return { min: 2133, max: 4800 };
  }
  return { min: 0, max: 10000 };
}

function isMemoryCompatible(memory, board) {
  const boardDdr = extractDdrType(board.info || board.specSummary || "");
  const memoryDdr = extractDdrType(memory.name || memory.info || "");
  if (boardDdr && memoryDdr && boardDdr !== memoryDdr) return false;
  const memorySpeed = extractMemorySpeed(memory.name || memory.info || "");
  if (memorySpeed > 0) {
    const boardSpeedRange = extractBoardMemorySpeedRange(board);
    if (memorySpeed < boardSpeedRange.min || memorySpeed > boardSpeedRange.max) return false;
  }
  return true;
}

function extractMemoryCapacity(memory) {
  const text = `${memory.name || ""} ${memory.info || ""}`.toUpperCase();
  const patterns = [/(\d+)\s*GB\s*\(/i, /(\d+)\s*GB(?!\s*X)/i, /GB\s*(\d+)/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const capacity = parseInt(match[1]);
      if (capacity >= 4 && capacity <= 256) return capacity;
    }
  }
  return 16;
}

function extractTdp(text = "") {
  const match = text.match(/TDP[:\s]*(\d+)\s*W/i) || text.match(/(\d+)\s*W/i);
  return match ? parseInt(match[1]) : 0;
}

function parseCoolerSpecs(cooler) {
  const text = `${cooler.name || ""} ${cooler.info || ""} ${cooler.specSummary || ""}`;
  const combined = text.toUpperCase();
  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1X]/i.test(combined)) sockets.push("LGA115X");
  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  const tdpW = tdpMatch ? parseInt(tdpMatch[1]) : 0;
  return { sockets, tdpW };
}

function isCoolerCompatible(cooler, cpuSocket, cpuTdp) {
  const coolerSpecs = parseCoolerSpecs(cooler);
  const cpuNorm = normalizeSocket(cpuSocket);
  const hasSocket = coolerSpecs.sockets.some(s => normalizeSocket(s) === cpuNorm);
  if (!hasSocket && cpuSocket) return false;
  if (coolerSpecs.tdpW > 0 && cpuTdp > 0 && coolerSpecs.tdpW < cpuTdp * 0.8) return false;
  return true;
}

const getCpuScore = (cpu) => cpu.benchmarkScore?.passmarkscore || cpu.benchScore || 0;
const getGpuScore = (gpu) => gpu.benchmarkScore?.["3dmarkscore"] || gpu.benchScore || 0;

/* ==================== AI 견적 평가 생성 ==================== */
async function generateBuildEvaluation(build, purpose, budget) {
  if (!OPENAI_API_KEY) {
    return { evaluation: "", strengths: [], recommendations: [] };
  }

  const parts = build.parts || {};
  const partsList = [
    `CPU: ${parts.cpu?.name || ""} (${parts.cpu?.price?.toLocaleString() || 0}원)`,
    `GPU: ${parts.gpu?.name || ""} (${parts.gpu?.price?.toLocaleString() || 0}원)`,
    `메인보드: ${parts.motherboard?.name || ""} (${parts.motherboard?.price?.toLocaleString() || 0}원)`,
    `메모리: ${parts.memory?.name || ""} (${parts.memory?.price?.toLocaleString() || 0}원)`,
    `PSU: ${parts.psu?.name || ""} (${parts.psu?.price?.toLocaleString() || 0}원)`,
    `쿨러: ${parts.cooler?.name || ""} (${parts.cooler?.price?.toLocaleString() || 0}원)`,
    `스토리지: ${parts.storage?.name || ""} (${parts.storage?.price?.toLocaleString() || 0}원)`,
    `케이스: ${parts.case?.name || ""} (${parts.case?.price?.toLocaleString() || 0}원)`,
  ].join("\n");

  const compatibility = build.compatibility || {};
  const compatibilityInfo = [
    `소켓 호환: ${compatibility.socket || ""}`,
    `메모리 호환: ${compatibility.ddr || ""}`,
    `전력 소비: ${compatibility.power || ""}`,
  ].join(", ");

  const prompt = `${build.label} 견적 (열 ${build.totalPrice?.toLocaleString() || 0}원)에 대한 전문가 평가를 작성해주세요.\n\n용도: ${purpose}\n예산: ${budget.toLocaleString()}원\n총 견적: ${build.totalPrice?.toLocaleString() || 0}원\n\n부품 구성:\n${partsList}\n\n호환성: ${compatibilityInfo}\n\n다음 형식으로 JSON 응답해주세요:\n{\n  "evaluation": "<200자 이내의 전체 견적 평가>",\n  "strengths": ["<장점1>", "<장점2>", "<장점3>"],\n  "recommendations": ["<추천사항1>", "<추천사항2>"]\n}`;

  const timeout = (ms) => new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`AI 평가 타임아웃 (${ms}ms 초과)`)), ms)
  );

  for (let i = 0; i < 2; i++) {
    try {
      logger.info(`AI 평가 생성 시도 ${i + 1}/2: ${build.label} 빌드`);
      const res = await Promise.race([
        fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.6,
            messages: [
              { role: "system", content: "너는 PC 견적 전문가야. JSON만 출력해." },
              { role: "user", content: prompt },
            ],
          }),
        }),
        timeout(config.apiTimeouts.aiEvaluation),
      ]);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: { message: "알 수 없는 오류" } }));
        const errorMessage = errorData?.error?.message || "알 수 없는 오류";
        const errorCode = errorData?.error?.code || "unknown";
        logger.error(`OpenAI API 오류 (${res.status}): ${errorMessage}`);
        if (res.status === 429 && errorCode === "insufficient_quota") break;
        continue;
      }

      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      if (!raw) { logger.warn("OpenAI 응답이 비어있음"); continue; }

      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}") + 1;
      if (start === -1 || end === 0) { logger.warn("JSON을 찾을 수 없음"); continue; }

      const parsed = JSON.parse(raw.slice(start, end));
      return {
        evaluation: parsed.evaluation?.trim() || "",
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    } catch (e) {
      if (e.message?.includes('타임아웃')) {
        logger.warn(`AI 평가 타임아웃: ${e.message}`);
      } else {
        logger.error(`AI 평가 재시도 ${i + 1}/2 실패: ${e.message}`);
      }
      if (i < 1) await sleep(1000);
    }
  }

  return {
    evaluation: "",
    strengths: [],
    recommendations: [],
    error: "OpenAI API 할당량이 부족하거나 설정에 문제가 있습니다.",
  };
}

/* ==================== 개선된 추천 로직 ==================== */

router.post("/", validate(recommendSchema), async (req, res) => {
  try {
    const { budget, purpose } = req.body;

    logger.info(`추천 요청: 예산 ${budget.toLocaleString()}원, 용도: ${purpose}`);

    const db = getDB();
    if (!db) {
      return res.status(500).json({ error: "DATABASE_ERROR", message: "데이터베이스 연결에 실패했습니다." });
    }

    const { cpus, gpus, memories, boards, psus, coolers, storages, cases } = await loadParts(db);

    logger.info(`부품 로드: CPU(${cpus.length}), GPU(${gpus.length}), Memory(${memories.length}), Board(${boards.length})`);

    const weights = {
      "사무용": { cpu: 0.4, gpu: 0.2, cpuBudgetRatio: 0.25, gpuBudgetRatio: 0.15 },
      "게임용": { cpu: 0.45, gpu: 0.6, cpuBudgetRatio: 0.30, gpuBudgetRatio: 0.40 },
      "작업용": { cpu: 0.5, gpu: 0.4, cpuBudgetRatio: 0.30, gpuBudgetRatio: 0.25 },
      "가성비": { cpu: 0.4, gpu: 0.5, cpuBudgetRatio: 0.25, gpuBudgetRatio: 0.30 },
    };
    const weight = weights[purpose] || weights["가성비"];

    const minBudget = budget * 0.90;
    const maxBudget = budget * 1.10;
    const maxCpuPrice = budget * weight.cpuBudgetRatio;
    const idealCpuPrice = budget * weight.cpuBudgetRatio * 0.7;

    let cpuCandidates = cpus.filter(c => {
      const cpuName = (c.name || "").toUpperCase();
      if (purpose === "게임용" && /제온|XEON|EPYC|THREADRIPPER/i.test(cpuName)) return false;
      if (c.price > maxCpuPrice) return false;
      return extractCpuSocket(c) !== "";
    });

    if (cpuCandidates.length === 0) {
      cpuCandidates = cpus.filter(c => {
        const cpuName = (c.name || "").toUpperCase();
        if (purpose === "게임용" && /제온|XEON|EPYC|THREADRIPPER/i.test(cpuName)) return false;
        return c.price <= maxCpuPrice;
      });
    }

    cpuCandidates = cpuCandidates.map(c => {
      const score = getCpuScore(c);
      const valueScore = score > 0 ? (score / c.price) * weight.cpu : 0;
      const budgetFitScore = 1 / (1 + Math.abs(c.price - idealCpuPrice) / idealCpuPrice);
      const combinedScore = score > 0 ? valueScore * 0.6 + budgetFitScore * 0.4 : budgetFitScore;
      return { ...c, weightedScore: combinedScore };
    }).sort((a, b) => b.weightedScore - a.weightedScore).slice(0, 12);

    const maxGpuPrice = budget * weight.gpuBudgetRatio;
    const idealGpuPrice = budget * weight.gpuBudgetRatio * 0.7;

    const gpuCandidates = gpus
      .filter(g => getGpuScore(g) > 0 && g.price <= maxGpuPrice)
      .map(g => {
        const valueScore = (getGpuScore(g) / g.price) * weight.gpu;
        const budgetFitScore = 1 / (1 + Math.abs(g.price - idealGpuPrice) / idealGpuPrice);
        return { ...g, weightedScore: valueScore * 0.6 + budgetFitScore * 0.4 };
      })
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 12);

    if (cpuCandidates.length === 0 || gpuCandidates.length === 0) {
      return res.status(400).json({
        error: "INSUFFICIENT_CANDIDATES",
        message: cpuCandidates.length === 0
          ? "예산 범위 내의 CPU를 찾을 수 없습니다."
          : "예산 범위 내의 GPU를 찾을 수 없습니다.",
        debug: { cpuCandidates: cpuCandidates.length, gpuCandidates: gpuCandidates.length, budget },
      });
    }

    const results = [];
    const filterStats = { cpuGpuTooExpensive: 0, bottleneck: 0, remainingTooLow: 0, noSocket: 0, noBoard: 0, noMemory: 0, noPSU: 0, noCooler: 0, noStorage: 0, noCase: 0, budgetRange: 0, success: 0 };

    function checkBottleneck(cpuScore, gpuScore, purpose, userBudget) {
      if (cpuScore <= 0 || gpuScore <= 0) return true;
      const isVeryLowBudget = userBudget < 700000;
      const isLowBudget = userBudget < 1000000;
      const isMidBudget = userBudget >= 1000000 && userBudget < 3000000;
      const cpuRatio = Math.min(cpuScore / 80000, 1);
      const gpuRatio = Math.min(gpuScore / 60000, 1);
      const baseRatios = {
        "게임용": { min: 0.4, max: 2.5 },
        "작업용": { min: 0.7, max: 2.0 },
        "사무용": { min: 0.3, max: 3.0 },
        "가성비": { min: 0.5, max: 2.0 },
      };
      let ratio = baseRatios[purpose] || baseRatios["가성비"];
      if (isVeryLowBudget) ratio = { min: 0.2, max: 4.0 };
      else if (isLowBudget) ratio = { min: Math.max(0.3, ratio.min * 0.6), max: Math.min(3.5, ratio.max * 1.5) };
      else if (isMidBudget) ratio = { min: Math.max(0.35, ratio.min * 0.8), max: Math.min(3.0, ratio.max * 1.3) };
      const performanceRatio = gpuRatio / (cpuRatio || 0.1);
      return performanceRatio >= ratio.min && performanceRatio <= ratio.max;
    }

    for (const cpu of cpuCandidates) {
      for (const gpu of gpuCandidates) {
        if (results.length >= 50) break;
        if (!checkBottleneck(getCpuScore(cpu), getGpuScore(gpu), purpose, budget)) { filterStats.bottleneck++; continue; }

        const cpuGpuCost = cpu.price + gpu.price;
        const targetTotalBudget = budget;
        const targetOtherPartsBudget = targetTotalBudget - cpuGpuCost;

        if (cpuGpuCost > targetTotalBudget * 0.70) { filterStats.cpuGpuTooExpensive++; continue; }
        if (targetOtherPartsBudget < 150000) { filterStats.remainingTooLow++; continue; }

        const cpuSocket = extractCpuSocket(cpu);
        if (!cpuSocket) { filterStats.noSocket++; continue; }

        const boardBudget = targetOtherPartsBudget * 0.20;
        const memoryBudget = targetOtherPartsBudget * 0.15;
        const psuBudget = targetOtherPartsBudget * 0.12;
        const coolerBudget = targetOtherPartsBudget * 0.08;
        const storageBudget = targetOtherPartsBudget * 0.25;
        const caseBudget = targetOtherPartsBudget * 0.20;

        const compatibleBoards = boards.filter(b => {
          const bSocket = extractBoardSocket(b);
          if (!isSocketCompatible(cpuSocket, bSocket)) return false;
          return b.price <= boardBudget * 1.5 && b.price >= 30000;
        });
        if (compatibleBoards.length === 0) { filterStats.noBoard++; continue; }
        const board = compatibleBoards.sort((a, b) => Math.abs(a.price - boardBudget) - Math.abs(b.price - boardBudget))[0];
        const boardFormFactor = extractBoardFormFactor(board);

        let memoryCapacityReq = purpose === "작업용" ? 32 : 16;
        let compatibleMemories = memories.filter(m => {
          if (!isMemoryCompatible(m, board)) return false;
          return extractMemoryCapacity(m) >= memoryCapacityReq && m.price <= memoryBudget * 2.0 && m.price >= 30000;
        });
        if (compatibleMemories.length === 0 && purpose === "작업용") {
          memoryCapacityReq = 16;
          compatibleMemories = memories.filter(m => {
            if (!isMemoryCompatible(m, board)) return false;
            return extractMemoryCapacity(m) >= 16 && m.price <= memoryBudget * 2.5 && m.price >= 30000;
          });
        }
        if (compatibleMemories.length === 0) {
          const boardDdrType = extractDdrType(board.info || board.specSummary || "");
          compatibleMemories = memories.filter(m => {
            const memoryDdr = extractDdrType(m.name || m.info || "");
            if (boardDdrType && memoryDdr && boardDdrType !== memoryDdr) return false;
            return extractMemoryCapacity(m) >= Math.max(8, memoryCapacityReq * 0.5) && m.price <= memoryBudget * 3.0 && m.price >= 30000;
          });
        }
        if (compatibleMemories.length === 0) { filterStats.noMemory++; continue; }
        const memory = compatibleMemories.sort((a, b) => {
          const aCap = extractMemoryCapacity(a), bCap = extractMemoryCapacity(b);
          if (aCap !== bCap) return bCap - aCap;
          return Math.abs(a.price - memoryBudget) - Math.abs(b.price - memoryBudget);
        })[0];

        const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
        const gpuTdp = extractTdp(gpu.info || "");
        const totalTdp = cpuTdp + gpuTdp + 100;

        const compatiblePsus = psus.filter(p => {
          const psuWattage = extractTdp(p.name || p.info || "");
          return psuWattage >= totalTdp * 1.2 && p.price <= psuBudget * 1.5 && p.price >= 40000;
        });
        if (compatiblePsus.length === 0) { filterStats.noPSU++; continue; }
        const psu = compatiblePsus.sort((a, b) => Math.abs(a.price - psuBudget) - Math.abs(b.price - psuBudget))[0];

        const compatibleCoolers = coolers.filter(c => {
          if (!isCoolerCompatible(c, cpuSocket, cpuTdp)) return false;
          return c.price <= coolerBudget * 1.5 && c.price >= 15000;
        });
        if (compatibleCoolers.length === 0) { filterStats.noCooler++; continue; }
        const cooler = compatibleCoolers.sort((a, b) => {
          const aSpecs = parseCoolerSpecs(a), bSpecs = parseCoolerSpecs(b);
          if (cpuTdp > 0 && aSpecs.tdpW > 0 && bSpecs.tdpW > 0) {
            const aMargin = aSpecs.tdpW - cpuTdp, bMargin = bSpecs.tdpW - cpuTdp;
            if (Math.abs(aMargin - bMargin) > 20) return bMargin - aMargin;
          }
          return Math.abs(a.price - coolerBudget) - Math.abs(b.price - coolerBudget);
        })[0];

        const remainingAfterCooler = targetOtherPartsBudget - board.price - memory.price - psu.price - cooler.price;
        const adjustedStorageBudget = Math.min(storageBudget * 1.2, remainingAfterCooler * 0.6);
        const compatibleStorages = storages.filter(s => s.price <= adjustedStorageBudget && s.price >= 50000);
        if (compatibleStorages.length === 0) { filterStats.noStorage++; continue; }
        const storage = compatibleStorages.sort((a, b) => Math.abs(a.price - storageBudget) - Math.abs(b.price - storageBudget))[0];

        const remainingAfterStorage = remainingAfterCooler - storage.price;
        const adjustedCaseBudget = Math.max(remainingAfterStorage, 30000);
        const compatibleCases = cases.filter(c => {
          if (!isCaseCompatible(c, boardFormFactor)) return false;
          return c.price <= adjustedCaseBudget && c.price >= 30000;
        });
        if (compatibleCases.length === 0) { filterStats.noCase++; continue; }
        const idealCasePrice = Math.min(adjustedCaseBudget * 0.8, caseBudget);
        const caseItem = compatibleCases.sort((a, b) => Math.abs(a.price - idealCasePrice) - Math.abs(b.price - idealCasePrice))[0];

        const totalPrice = cpu.price + gpu.price + memory.price + board.price + psu.price + cooler.price + storage.price + caseItem.price;
        if (totalPrice < minBudget || totalPrice > maxBudget) { filterStats.budgetRange++; continue; }

        filterStats.success++;
        const score = getCpuScore(cpu) * weight.cpu + getGpuScore(gpu) * weight.gpu;
        results.push({ cpu, gpu, memory, board, psu, cooler, storage, case: caseItem, totalPrice, score, cpuSocket, boardDdr: extractDdrType(board.info || board.specSummary || ""), totalTdp, boardFormFactor });
      }
      if (results.length >= 50) break;
    }

    logger.info(`조합 생성 완료: ${results.length}개, 통계: ${JSON.stringify(filterStats)}`);

    if (results.length === 0) {
      return res.status(400).json({
        error: "NO_VALID_COMBINATIONS",
        message: "예산에 맞는 조합을 찾을 수 없습니다. 예산을 늘리거나 다른 용도를 선택해보세요.",
        debug: { budget, purpose, filterStats },
      });
    }

    results.sort((a, b) => b.score - a.score);

    const builds = [];
    const costEfficient = results.slice().sort((a, b) => (b.score / b.totalPrice) - (a.score / a.totalPrice))[0];
    builds.push({ label: "가성비", ...costEfficient });

    const midPrice = budget * 0.85;
    const balanced = results.slice().sort((a, b) => Math.abs(a.totalPrice - midPrice) - Math.abs(b.totalPrice - midPrice))[0];
    if (balanced && balanced !== costEfficient) builds.push({ label: "균형", ...balanced });

    const highPerf = results[0];
    if (highPerf && highPerf !== costEfficient && highPerf !== balanced) builds.push({ label: "고성능", ...highPerf });

    const uniqueBuilds = Array.from(new Set(builds.map(b => b.cpu.name + b.gpu.name)))
      .map(key => builds.find(b => b.cpu.name + b.gpu.name === key));

    while (uniqueBuilds.length < 3 && uniqueBuilds.length < results.length) {
      const next = results.find(r => !uniqueBuilds.some(b => b.cpu.name === r.cpu.name && b.gpu.name === r.gpu.name));
      if (next) uniqueBuilds.push({ label: uniqueBuilds.length === 1 ? "균형" : "고성능", ...next });
      else break;
    }

    const reasons = [
      `${purpose} 용도에 최적화된 구성`,
      `예산 ${budget.toLocaleString()}원으로 ${uniqueBuilds.length}가지 조합 추천`,
      `${results.length}개 조합 중 최적 선택`,
    ];

    logger.info("AI 견적 평가 생성 중...");
    const buildsWithAI = await Promise.all(
      uniqueBuilds.map(async (b) => {
        const buildData = {
          label: b.label,
          totalPrice: b.totalPrice,
          score: Math.round(b.score),
          parts: {
            cpu: { name: b.cpu.name, price: b.cpu.price, image: b.cpu.image },
            gpu: { name: b.gpu.name, price: b.gpu.price, image: b.gpu.image },
            memory: { name: b.memory.name, price: b.memory.price, image: b.memory.image },
            motherboard: { name: b.board.name, price: b.board.price, image: b.board.image },
            psu: { name: b.psu.name, price: b.psu.price, image: b.psu.image },
            cooler: { name: b.cooler.name, price: b.cooler.price, image: b.cooler.image },
            storage: { name: b.storage.name, price: b.storage.price, image: b.storage.image },
            case: { name: b.case.name, price: b.case.price, image: b.case.image },
          },
          compatibility: {
            socket: `${b.cpuSocket} ↔ ${extractBoardSocket(b.board)}`,
            ddr: `${b.boardDdr} ↔ ${extractDdrType(b.memory.name)}`,
            power: `${b.totalTdp}W → ${extractTdp(b.psu.name)}W`,
            formFactor: `${b.boardFormFactor} ↔ ${b.case.specs?.formFactor?.join("/") || "ATX"}`,
          },
        };
        const aiCacheKey = makeAiCacheKey({ budget, purpose, label: b.label, cpuName: b.cpu.name, gpuName: b.gpu.name });
        const aiEvaluation = await getOrComputeRecommendation(aiCacheKey, () =>
          generateBuildEvaluation(buildData, purpose, budget)
        );
        return {
          ...buildData,
          aiEvaluation: aiEvaluation.evaluation || "",
          aiStrengths: aiEvaluation.strengths || [],
          aiRecommendations: aiEvaluation.recommendations || [],
          aiError: aiEvaluation.error || null,
        };
      })
    );

    logger.info("AI 견적 평가 완료");

    res.json({
      builds: buildsWithAI,
      recommended: uniqueBuilds[1]?.label || uniqueBuilds[0]?.label,
      message: `${purpose} 용도로 ${uniqueBuilds.length}가지 조합을 추천합니다!`,
      reasons,
    });

  } catch (error) {
    logger.error(`추천 오류: ${error.message}`);
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({
      error: "RECOMMENDATION_ERROR",
      message: isProduction ? "추천 생성 중 오류가 발생했습니다." : error.message,
      ...(isProduction ? {} : { stack: error.stack }),
    });
  }
});

// POST /api/recommend/upgrade
router.post("/upgrade", validate(upgradeAdvisorSchema), async (req, res) => {
  const { currentBuild, budget, purpose = "게임용" } = req.body;
  try {
    const db = getDB();

    // 퍼지 매칭으로 현재 부품 조회 (부분 이름 입력 허용)
    const [currentCpu, currentGpu] = await Promise.all([
      findPartForUpgrade(db, "cpu", currentBuild.cpu),
      findPartForUpgrade(db, "gpu", currentBuild.gpu),
    ]);

    const cpuScore = currentCpu?.benchmarkScore?.passmarkscore || 0;
    const gpuScore = currentGpu?.benchmarkScore?.["3dmarkscore"] || 0;

    logger.info(`업그레이드 어드바이저: CPU="${currentCpu?.name || "미인식"}" (${cpuScore}), GPU="${currentGpu?.name || "미인식"}" (${gpuScore})`);

    const upgradeTargets = resolveUpgradeTargets(purpose, cpuScore, gpuScore, currentBuild);

    const suggestions = (
      await Promise.all(
        upgradeTargets.map(async (target) => {
          const scoreKey =
            target.category === "cpu"
              ? "benchmarkScore.passmarkscore"
              : "benchmarkScore.3dmarkscore";
          const currentScore = target.category === "cpu" ? cpuScore : gpuScore;
          // 현재 부품의 DB _id (퍼지 매칭으로 찾은 경우 제외용)
          const currentPartId = target.category === "cpu" ? currentCpu?._id : currentGpu?._id;

          const filter = { category: target.category, price: { $gt: 0, $lte: budget } };
          // 현재 점수보다 높은 것만 (점수 0이면 조건 없음 — 하지만 현재 부품은 _id로 명시 제외)
          if (currentScore > 0) filter[scoreKey] = { $gt: currentScore };
          // 현재 부품 자체는 후보에서 제외
          if (currentPartId) filter._id = { $ne: currentPartId };

          const candidates = await db
            .collection("parts")
            .find(filter, { projection: { priceHistory: 0 } })
            .sort({ [scoreKey]: -1 })
            .limit(3)
            .toArray();

          if (candidates.length === 0) return null;

          return {
            category: target.category,
            reason: target.reason,
            priority: target.priority,
            currentName: target.category === "cpu" ? currentCpu?.name : currentGpu?.name,
            candidates: candidates.map((c) => {
              const newScore =
                target.category === "cpu"
                  ? (c.benchmarkScore?.passmarkscore || 0)
                  : (c.benchmarkScore?.["3dmarkscore"] || 0);
              const improvement =
                currentScore > 0
                  ? Math.round(((newScore - currentScore) / currentScore) * 100)
                  : null;
              return { ...c, _currentScore: currentScore, _newScore: newScore, _improvement: improvement };
            }),
          };
        })
      )
    ).filter(Boolean);

    res.json({
      currentBuild: {
        cpu: currentCpu?.name || currentBuild.cpu,
        gpu: currentGpu?.name || currentBuild.gpu,
      },
      budget,
      purpose,
      cpuScore,
      gpuScore,
      suggestions,
      summary:
        suggestions.length > 0
          ? `${suggestions[0].category.toUpperCase()} 업그레이드를 우선 권장합니다.`
          : "현재 예산 내에서 유의미한 업그레이드 옵션을 찾지 못했습니다.",
    });
  } catch (err) {
    logger.error(`업그레이드 어드바이저 실패: ${err.message}`);
    res.status(500).json({ error: "업그레이드 분석 실패" });
  }
});

function resolveUpgradeTargets(purpose, cpuScore, gpuScore, currentBuild) {
  const has = (k) => !!currentBuild[k];
  if (purpose === "게임용") {
    return [
      has("gpu") && { category: "gpu", reason: "게임 성능의 핵심은 GPU입니다.", priority: 1 },
      has("cpu") && { category: "cpu", reason: "CPU 병목 해소로 프레임 안정성이 향상됩니다.", priority: 2 },
    ].filter(Boolean);
  }
  if (purpose === "작업용") {
    return [
      has("cpu") && { category: "cpu", reason: "렌더링·인코딩 등 작업 성능의 핵심은 CPU입니다.", priority: 1 },
      has("gpu") && { category: "gpu", reason: "GPU 가속 지원 작업 성능이 향상됩니다.", priority: 2 },
    ].filter(Boolean);
  }
  if (purpose === "사무용") {
    return [
      has("cpu") && { category: "cpu", reason: "멀티태스킹 성능이 향상됩니다.", priority: 1 },
      has("memory") && { category: "memory", reason: "메모리 용량 확장으로 체감 속도가 향상됩니다.", priority: 2 },
    ].filter(Boolean);
  }
  const cpuNorm = cpuScore / 15000;
  const gpuNorm = gpuScore / 8000;
  const gpuIsWeaker = cpuNorm > gpuNorm;
  return [
    has(gpuIsWeaker ? "gpu" : "cpu") && {
      category: gpuIsWeaker ? "gpu" : "cpu",
      reason: "현재 구성의 상대적 약점을 보완합니다.",
      priority: 1,
    },
    has(gpuIsWeaker ? "cpu" : "gpu") && {
      category: gpuIsWeaker ? "cpu" : "gpu",
      reason: "추가 업그레이드 옵션입니다.",
      priority: 2,
    },
  ].filter(Boolean);
}

export default router;
