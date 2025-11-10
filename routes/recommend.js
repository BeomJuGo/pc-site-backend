// routes/recommend.js - 개선된 추천 알고리즘
import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";
import config from "../config.js";

const OPENAI_API_KEY = config.openaiApiKey;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const router = express.Router();

/* ==================== 유틸리티 함수 ==================== */

// 소켓 정규화: 다양한 형식을 통일된 형식으로 변환
function normalizeSocket(socket) {
  if (!socket) return "";
  const s = socket.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  // LGA115x 시리즈 통합
  if (/LGA115[0-1X]/.test(s)) return "LGA115X";
  return s;
}

function extractCpuSocket(cpu) {
  const text = `${cpu.name || ""} ${cpu.info || ""} ${cpu.specSummary || ""}`;
  const combined = text.toUpperCase();

  // "Socket: LGA1700" 또는 "Socket LGA1700" 형식에서 추출 (콜론 있거나 없거나)
  let socketMatch = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (socketMatch) {
    return normalizeSocket(socketMatch[1]);
  }

  // "LGA1700 소켓", "소켓 LGA1700" 형식 추출 (한글 소켓)
  const socketWithKeyword = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (socketWithKeyword) {
    return normalizeSocket(socketWithKeyword[1]);
  }

  // 직접 매칭 (공백, 하이픈 유무 상관없이)
  const match = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (match) {
    return normalizeSocket(match[1]);
  }

  // AMD Threadripper 시리즈 추론
  if (/AMD|라이젠/i.test(text) && /스레드리퍼|THREADRIPPER/i.test(combined)) {
    // Threadripper PRO 시리즈 (워크스테이션)
    if (/PRO|프로/i.test(combined)) {
      // 시마다 픽 (Granite Ridge) - 9955WX, 9965WX, 9975WX, 9985WX, 9995WX
      if (/9955|9965|9975|9985|9995|시마다|GRANITE/i.test(combined)) {
        return "sWRX9"; // 또는 최신 소켓
      }
      // 스톰 픽 (Storm Peak) - 7955WX, 7975WX, 7985WX, 7995WX
      if (/7955|7975|7985|7995|스톰|STORM/i.test(combined)) {
        return "sWRX9";
      }
      // 샤갈 프로 (Chagall PRO) - 5955WX, 5965WX, 5975WX, 5995WX
      if (/5955|5965|5975|5995|샤갈|CHAGALL/i.test(combined)) {
        return "sWRX8";
      }
      // 캐슬 픽-W (Castle Peak-W) - 3955WX, 3975WX, 3995WX
      if (/3955|3975|3995|캐슬|CASTLE/i.test(combined)) {
        return "sWRX8";
      }
    } else {
      // 일반 Threadripper (PRO 없음)
      // 시마다 픽 (Granite Ridge) - 9970X, 9960X, 9980X
      if (/9970|9960|9980|시마다|GRANITE/i.test(combined)) {
        return "sTRX5"; // 또는 TRX50
      }
      // 스톰 픽 (Storm Peak) - 7970X, 7960X, 7980X
      if (/7970|7960|7980|스톰|STORM/i.test(combined)) {
        return "sTRX5"; // 또는 TRX50
      }
      // 기타 Threadripper (이전 세대)
      if (/\b(29\d{2}|39\d{2}|49\d{2}|59\d{2})\b/.test(combined)) {
        return "sTRX4";
      }
    }
  }

  // Intel 세대/모델 기반 추론 (소켓 정보가 없을 때)
  if (/인텔|INTEL/i.test(text)) {
    // 제온 w5, w7 시리즈 (사파이어 래피드): LGA4677
    if (/제온|XEON/i.test(combined) && /(w5|w7)[-\s]?\d{4}/i.test(combined)) {
      if (/사파이어|SAPPHIRE|래피드|RAPID/i.test(combined)) {
        return "LGA4677";
      }
    }

    // 제온 스케일러블 골드/플래티넘 (에메랄드 래피드, 사파이어 래피드): LGA4677
    if (/제온|XEON/i.test(combined) && /스케일러블|SCALABLE/i.test(combined)) {
      if (/에메랄드|EMERALD|사파이어|SAPPHIRE|래피드|RAPID/i.test(combined)) {
        return "LGA4677";
      }
      // 골드/플래티넘 번호로 추론 (6xxx 시리즈는 일반적으로 LGA4677)
      if (/\b(6\d{3}|5\d{3})[A-Z]?\b/.test(combined)) {
        return "LGA4677";
      }
    }
    // 제온 E5 시리즈 (하스웰-EP, 브로드웰-EP): LGA2011-3
    if (/제온|XEON/i.test(combined) && /E5[-\s]?\d{4}/i.test(combined)) {
      if (/v4|브로드웰|BROADWELL/i.test(combined)) {
        return "LGA2011-3";
      }
      if (/v3|하스웰|HASWELL/i.test(combined)) {
        return "LGA2011-3";
      }
      // v4나 v3가 없으면 기본적으로 LGA2011-3 (대부분의 E5는 2011-3)
      if (/E5[-\s]?26\d{2}/i.test(combined)) {
        return "LGA2011-3";
      }
    }

    // 14세대, 13세대, 12세대: LGA1700
    if (/14세대|13세대|12세대|\b(14|13|12)\s*GEN/i.test(combined) ||
      /랩터레이크|RAPTOR|앨더레이크|ALDER/i.test(combined)) {
      return "LGA1700";
    }

    // 11세대, 10세대: LGA1200
    if (/11세대|10세대|\b(11|10)\s*GEN/i.test(combined) ||
      /로켓레이크|ROCKET|코멧레이크|COMET/i.test(combined)) {
      return "LGA1200";
    }

    // 9세대, 8세대: LGA1151
    if (/9세대|8세대|\b(9|8)\s*GEN/i.test(combined) ||
      /커피레이크|COFFEE/i.test(combined)) {
      return "LGA1151";
    }

    // 모델 번호 기반 추론 (예: 14400F, 13400, 12400 → LGA1700)
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

  // "Socket: LGA1700" 또는 "Socket LGA1700" 형식에서 추출 (콜론 있거나 없거나)
  let socketMatch = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (socketMatch) {
    return normalizeSocket(socketMatch[1]);
  }

  // "LGA1700 소켓", "소켓 LGA1700" 형식 추출 (한글 소켓)
  const socketWithKeyword = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (socketWithKeyword) {
    return normalizeSocket(socketWithKeyword[1]);
  }

  // 직접 매칭 (공백, 하이픈 유무 상관없이)
  const match = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (match) {
    return normalizeSocket(match[1]);
  }

  // 칩셋 기반 추론 (칩셋 → 소켓 매핑)
  // 최신 칩셋부터 확인 (순서 중요!)

  // AMD 900 시리즈 (AM5 소켓)
  if (/B850|X870|A850|B850E|X870E/i.test(combined)) return "AM5";

  // AMD 600/500 시리즈 (AM5 소켓)
  if (/AM5|B650|X670|A620|B650E|X670E/i.test(combined)) return "AM5";

  // AMD 400/300 시리즈 (AM4 소켓)
  if (/AM4|B550|X570|A520|B450|X470|B350|X370/i.test(combined)) return "AM4";

  // AMD Threadripper
  if (/sTRX4|TRX40/i.test(combined)) return "sTRX4";
  if (/TR4|X399/i.test(combined)) return "TR4";
  if (/SP3|EPYC/i.test(combined)) return "SP3";

  // Intel Arrow Lake (LGA1851 소켓) - 최신
  if (/Z890|B860|H870|LGA\s?1851/i.test(combined)) return "LGA1851";

  // Intel Alder Lake / Raptor Lake (LGA1700 소켓)
  if (/Z790|B760|H770|Z690|B660|H610|H670|LGA\s?1700/i.test(combined)) return "LGA1700";

  // Intel Comet Lake / Rocket Lake (LGA1200 소켓)
  if (/Z590|B560|H570|Z490|B460|H410|LGA\s?1200/i.test(combined)) return "LGA1200";

  // Intel Coffee Lake / Kaby Lake (LGA1151 소켓)
  if (/Z390|B360|H370|Z370|B250|H270|Z270|B150|H170|Z170|LGA\s?1151/i.test(combined)) return "LGA1151";

  // 기타 Intel 소켓
  if (/X299|LGA\s?2066/i.test(combined)) return "LGA2066";
  if (/X99|LGA\s?2011[-\s]?(?:3|V3)/i.test(combined)) return "LGA2011-3";
  if (/X79|LGA\s?2011/i.test(combined)) return "LGA2011";
  if (/X58|LGA\s?1366/i.test(combined)) return "LGA1366";
  if (/Z97|H97|Z87|H87|B85|H81|LGA\s?1150/i.test(combined)) return "LGA1150";
  if (/Z77|H77|Z68|P67|H67|B75|LGA\s?1155/i.test(combined)) return "LGA1155";
  if (/P45|P35|G41|LGA\s?775/i.test(combined)) return "LGA775";

  // 일반화된 LGA 표기 추출
  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `LGA${lga[1]}`;

  return "";
}

// 소켓 호환성 체크 (정규화된 소켓으로 비교)
function isSocketCompatible(cpuSocket, boardSocket) {
  if (!cpuSocket || !boardSocket) return false;
  const cpuNorm = normalizeSocket(cpuSocket);
  const boardNorm = normalizeSocket(boardSocket);
  return cpuNorm === boardNorm;
}

function extractDdrType(text = "") {
  const match = text.toUpperCase().match(/DDR([45])/);
  return match ? `DDR${match[1]}` : "";
}

// 메모리 속도(클럭) 추출 (MHz)
function extractMemorySpeed(text = "") {
  const patterns = [
    /(\d{4,5})\s*MHz/i,           // 3200MHz, 6000MHz
    /DDR[45][-\s]?(\d{4,5})/i,    // DDR4-3200, DDR5-6000
    /(\d{4,5})\s*MT\/S/i,         // 3200 MT/s
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const speed = parseInt(match[1]);
      if (speed >= 1600 && speed <= 10000) return speed; // 유효 범위
    }
  }
  return 0;
}

// 메인보드가 지원하는 메모리 속도 범위 추출
function extractBoardMemorySpeedRange(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`.toUpperCase();

  // 일반적인 메인보드 메모리 속도 지원 범위 (칩셋/소켓 기반)
  const boardSocket = extractBoardSocket(board);
  const boardDdr = extractDdrType(text);

  // DDR5 메인보드
  if (boardDdr === "DDR5") {
    // AM5 (AMD 600/900 시리즈)
    if (boardSocket === "AM5") {
      return { min: 4800, max: 7200 }; // 일반적으로 4800-7200MHz
    }
    // LGA1700 (Intel 12/13/14세대)
    if (boardSocket === "LGA1700") {
      return { min: 4800, max: 8000 }; // 일반적으로 4800-8000MHz
    }
    // LGA1851 (Intel Arrow Lake)
    if (boardSocket === "LGA1851") {
      return { min: 5600, max: 8000 }; // 일반적으로 5600-8000MHz
    }
    // 기본 DDR5 범위
    return { min: 4800, max: 7200 };
  }

  // DDR4 메인보드
  if (boardDdr === "DDR4") {
    // AM4
    if (boardSocket === "AM4") {
      return { min: 2133, max: 5200 }; // 일반적으로 2133-5200MHz
    }
    // LGA1700 (DDR4 지원 모델)
    if (boardSocket === "LGA1700") {
      return { min: 2133, max: 4800 }; // 일반적으로 2133-4800MHz
    }
    // LGA1200, LGA1151
    if (boardSocket === "LGA1200" || boardSocket === "LGA1151") {
      return { min: 2133, max: 4000 }; // 일반적으로 2133-4000MHz
    }
    // 기본 DDR4 범위
    return { min: 2133, max: 4800 };
  }

  // DDR 타입을 알 수 없으면 넓은 범위 반환
  return { min: 0, max: 10000 };
}

// 메모리와 메인보드 호환성 체크
function isMemoryCompatible(memory, board) {
  const boardDdr = extractDdrType(board.info || board.specSummary || "");
  const memoryDdr = extractDdrType(memory.name || memory.info || "");

  // DDR 타입이 다르면 호환 불가
  if (boardDdr && memoryDdr && boardDdr !== memoryDdr) {
    return false;
  }

  // 메모리 속도 체크
  const memorySpeed = extractMemorySpeed(memory.name || memory.info || "");
  if (memorySpeed > 0) {
    const boardSpeedRange = extractBoardMemorySpeedRange(board);
    if (memorySpeed < boardSpeedRange.min || memorySpeed > boardSpeedRange.max) {
      return false; // 메모리 속도가 메인보드 지원 범위를 벗어남
    }
  }

  return true;
}

function extractMemoryCapacity(memory) {
  const text = `${memory.name || ""} ${memory.info || ""}`.toUpperCase();
  const patterns = [
    /(\d+)\s*GB\s*\(/i,
    /(\d+)\s*GB(?!\s*X)/i,
    /GB\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const capacity = parseInt(match[1]);
      if (capacity >= 4 && capacity <= 256) return capacity;
    }
  }
  return 16; // 기본값
}

function extractTdp(text = "") {
  const match = text.match(/TDP[:\s]*(\d+)\s*W/i) || text.match(/(\d+)\s*W/i);
  return match ? parseInt(match[1]) : 0;
}

// 쿨러 호환성 체크 (소켓 + TDP)
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

  // 소켓 호환성 체크
  const cpuNorm = normalizeSocket(cpuSocket);
  const hasSocket = coolerSpecs.sockets.some(s => normalizeSocket(s) === cpuNorm);
  if (!hasSocket && cpuSocket) return false;

  // TDP 호환성 체크 (쿨러 TDP가 CPU TDP보다 크거나 같아야 함, 단 쿨러 TDP가 0이면 무시)
  if (coolerSpecs.tdpW > 0 && cpuTdp > 0 && coolerSpecs.tdpW < cpuTdp * 0.8) {
    return false; // 쿨러 TDP가 CPU TDP의 80% 미만이면 부적합
  }

  return true;
}

const getCpuScore = (cpu) => cpu.benchmarkScore?.passmarkscore || cpu.benchScore || 0;
const getGpuScore = (gpu) => gpu.benchmarkScore?.["3dmarkscore"] || gpu.benchScore || 0;

/* ==================== AI 견적 평가 생성 ==================== */
async function generateBuildEvaluation(build, purpose, budget) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정 - AI 평가 생성 건너뜀");
    return {
      evaluation: "",
      strengths: [],
      recommendations: [],
    };
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

  const prompt = `${build.label} 견적 (총 ${build.totalPrice?.toLocaleString() || 0}원)에 대한 전문가 평가를 작성해주세요.

용도: ${purpose}
예산: ${budget.toLocaleString()}원
총 견적: ${build.totalPrice?.toLocaleString() || 0}원

부품 구성:
${partsList}

호환성: ${compatibilityInfo}

다음 형식으로 JSON 응답해주세요:
{
  "evaluation": "<200자 이내의 전체 견적 평가>",
  "strengths": ["<장점1>", "<장점2>", "<장점3>"],
  "recommendations": ["<추천사항1>", "<추천사항2>"]
}`;

  // 타임아웃 헬퍼 함수
  const timeout = (ms) => new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`AI 평가 타임아웃 (${ms}ms 초과)`)), ms)
  );

  for (let i = 0; i < 2; i++) {
    try {
      console.log(`🤖 AI 평가 생성 시도 ${i + 1}/2: ${build.label} 빌드`);

      // 30초 타임아웃 설정
      const fetchPromise = fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          temperature: 0.6,
          messages: [
            { role: "system", content: "너는 PC 견적 전문가야. JSON만 출력해." },
            { role: "user", content: prompt },
          ],
        }),
      });

      // 타임아웃 적용 (config에서 가져옴)
      const res = await Promise.race([
        fetchPromise,
        timeout(config.apiTimeouts.aiEvaluation)
      ]);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: { message: "알 수 없는 오류" } }));
        const errorMessage = errorData?.error?.message || "알 수 없는 오류";
        const errorCode = errorData?.error?.code || "unknown";

        console.error(`❌ OpenAI API 오류 (${res.status}):`, errorMessage);

        // 할당량 초과 오류는 재시도하지 않음
        if (res.status === 429 && errorCode === "insufficient_quota") {
          console.error("⚠️ OpenAI 할당량 초과 - AI 평가 기능을 사용할 수 없습니다.");
          break; // 재시도 중단
        }

        continue;
      }

      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";

      if (!raw) {
        console.warn("⚠️ OpenAI 응답이 비어있음");
        continue;
      }

      console.log(`📝 OpenAI 원본 응답 (${raw.length}자):`, raw.substring(0, 200));

      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}") + 1;

      if (start === -1 || end === 0) {
        console.warn("⚠️ JSON을 찾을 수 없음. 원본:", raw.substring(0, 300));
        continue;
      }

      const jsonStr = raw.slice(start, end);
      const parsed = JSON.parse(jsonStr);

      const result = {
        evaluation: parsed.evaluation?.trim() || "",
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };

      console.log(`✅ AI 평가 생성 성공:`, {
        evaluationLength: result.evaluation.length,
        strengthsCount: result.strengths.length,
        recommendationsCount: result.recommendations.length,
      });

      return result;
    } catch (e) {
      // 타임아웃 에러 처리
      if (e.message && e.message.includes('타임아웃')) {
        console.error(`⏱️ AI 평가 타임아웃 (${config.apiTimeouts.aiEvaluation}ms 초과):`, e.message);
      } else {
        console.error(`❌ AI 평가 생성 재시도 ${i + 1}/2 실패:`, e.message);
        if (e.stack) console.error("스택:", e.stack);
      }
      if (i < 1) await sleep(1000);
    }
  }

  console.warn("⚠️ AI 평가 생성 최종 실패 - 빈 값 반환");

  return {
    evaluation: "",
    strengths: [],
    recommendations: [],
    error: "OpenAI API 할당량이 부족하거나 설정에 문제가 있습니다.",
  };
}

/* ==================== 개선된 추천 로직 ==================== */

router.post("/", async (req, res) => {
  try {
    const { budget, purpose } = req.body;

    // 입력 검증 강화 (config 사용)
    if (!budget || typeof budget !== 'number' || isNaN(budget)) {
      return res.status(400).json({
        error: "INVALID_BUDGET",
        message: "예산은 숫자여야 합니다."
      });
    }

    if (budget < config.validation.minBudget) {
      return res.status(400).json({
        error: "BUDGET_TOO_LOW",
        message: `최소 예산은 ${config.validation.minBudget.toLocaleString()}원입니다.`
      });
    }

    if (budget > config.validation.maxBudget) {
      return res.status(400).json({
        error: "BUDGET_TOO_HIGH",
        message: `최대 예산은 ${config.validation.maxBudget.toLocaleString()}원입니다.`
      });
    }

    if (!purpose || !config.validation.validPurposes.includes(purpose)) {
      return res.status(400).json({
        error: "INVALID_PURPOSE",
        message: `용도는 다음 중 하나여야 합니다: ${config.validation.validPurposes.join(", ")}`,
        validPurposes: config.validation.validPurposes
      });
    }

    console.log(`\n🎯 추천 요청: 예산 ${budget.toLocaleString()}원, 용도: ${purpose}`);

    const db = getDB();
    if (!db) {
      return res.status(500).json({
        error: "DATABASE_ERROR",
        message: "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해주세요."
      });
    }

    const col = db.collection("parts");

    // 필요한 필드만 조회하여 성능 최적화
    const projection = {
      name: 1,
      price: 1,
      image: 1,
      benchmarkScore: 1,
      specSummary: 1,
      info: 1,
      category: 1,
      manufacturer: 1,
      specs: 1
    };

    // 모든 부품 가져오기 (필요한 필드만)
    const [cpus, gpus, memories, boards, psus, coolers, storages, cases] = await Promise.all([
      col.find({ category: "cpu", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "gpu", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "memory", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "motherboard", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "psu", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "cooler", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "storage", price: { $gt: 0 } }, { projection }).toArray(),
      col.find({ category: "case", price: { $gt: 0 } }, { projection }).toArray(),
    ]);

    console.log(`📦 부품: CPU(${cpus.length}), GPU(${gpus.length}), Memory(${memories.length}), Board(${boards.length})`);

    // 용도별 가중치 및 예산 배분
    const weights = {
      "사무용": { cpu: 0.4, gpu: 0.2, cpuBudgetRatio: 0.25, gpuBudgetRatio: 0.15 },
      "게임용": { cpu: 0.3, gpu: 0.6, cpuBudgetRatio: 0.20, gpuBudgetRatio: 0.40 },
      "작업용": { cpu: 0.5, gpu: 0.4, cpuBudgetRatio: 0.30, gpuBudgetRatio: 0.25 },
      "가성비": { cpu: 0.4, gpu: 0.5, cpuBudgetRatio: 0.25, gpuBudgetRatio: 0.30 },
    };
    const weight = weights[purpose] || weights["가성비"];

    // 예산 범위: 90-110% (사용자 예산에 더 정확하게 맞춤)
    const minBudget = budget * 0.90;
    const maxBudget = budget * 1.10;

    // CPU/GPU 필터링 및 정렬 (예산에 맞는 적절한 가격대 선택)
    // 소켓 정보가 있는 CPU만 필터링 (제온 등 워크스테이션 CPU 제외 가능)
    const maxCpuPrice = budget * weight.cpuBudgetRatio;
    const idealCpuPrice = budget * weight.cpuBudgetRatio * 0.7; // 이상적인 CPU 가격: 예산의 70%

    // CPU 필터링 (단계별로 완화)
    let cpuCandidates = cpus
      .filter(c => {
        const cpuName = (c.name || "").toUpperCase();

        // 게임용에서는 제온(Xeon) 서버 CPU 제외 (메인보드 호환성 문제)
        if (purpose === "게임용" && (/제온|XEON|EPYC|THREADRIPPER/i.test(cpuName))) {
          return false;
        }

        // 가격 조건 (필수)
        if (c.price > maxCpuPrice) {
          return false;
        }

        // 소켓 정보가 있으면 우선 (필수는 아님)
        const socket = extractCpuSocket(c);
        return socket !== "";
      });

    // 소켓 정보가 있는 CPU가 없으면 소켓 조건 완화
    if (cpuCandidates.length === 0) {
      console.log("   ⚠️ 소켓 정보가 있는 CPU가 없음 - 소켓 조건 완화");
      cpuCandidates = cpus
        .filter(c => {
          const cpuName = (c.name || "").toUpperCase();
          if (purpose === "게임용" && (/제온|XEON|EPYC|THREADRIPPER/i.test(cpuName))) {
            return false;
          }
          return c.price <= maxCpuPrice; // 가격만 체크
        });
    }

    // 점수 및 정렬 처리
    cpuCandidates = cpuCandidates
      .map(c => {
        // 예산에 맞는 CPU 선택: 가성비와 예산 활용도 모두 고려
        const score = getCpuScore(c);
        const valueScore = score > 0 ? (score / c.price) * weight.cpu : 0; // 가성비 점수 (점수가 없으면 0)
        const budgetFitScore = 1 / (1 + Math.abs(c.price - idealCpuPrice) / idealCpuPrice); // 예산 적합도 (0~1)
        const combinedScore = score > 0
          ? valueScore * 0.6 + budgetFitScore * 0.4  // 가성비 60% + 예산 적합도 40%
          : budgetFitScore * 1.0; // 점수가 없으면 예산 적합도만 고려 (100%)

        return {
          ...c,
          weightedScore: combinedScore
        };
      })
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 12); // 상위 12개로 확대

    const maxGpuPrice = budget * weight.gpuBudgetRatio;
    const idealGpuPrice = budget * weight.gpuBudgetRatio * 0.7; // 이상적인 GPU 가격: 예산의 70%

    const gpuCandidates = gpus
      .filter(g => {
        const score = getGpuScore(g);
        return score > 0 &&
          g.price <= maxGpuPrice;
      })
      .map(g => {
        // 예산에 맞는 GPU 선택: 가성비와 예산 활용도 모두 고려
        const valueScore = (getGpuScore(g) / g.price) * weight.gpu; // 가성비 점수
        const budgetFitScore = 1 / (1 + Math.abs(g.price - idealGpuPrice) / idealGpuPrice); // 예산 적합도 (0~1)
        const combinedScore = valueScore * 0.6 + budgetFitScore * 0.4; // 가성비 60% + 예산 적합도 40%

        return {
          ...g,
          weightedScore: combinedScore
        };
      })
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 12); // 상위 12개로 확대

    console.log(`🔍 후보: CPU(${cpuCandidates.length}), GPU(${gpuCandidates.length})`);

    if (cpuCandidates.length === 0 || gpuCandidates.length === 0) {
      console.error(`❌ 후보 부족: CPU=${cpuCandidates.length}, GPU=${gpuCandidates.length}`);
      console.error(`   전체 CPU: ${cpus.length}개, 필터링 전`);
      console.error(`   전체 GPU: ${gpus.length}개, 필터링 전`);
      console.error(`   예산: ${budget.toLocaleString()}원`);
      console.error(`   maxCpuPrice: ${maxCpuPrice.toLocaleString()}원`);
      console.error(`   maxGpuPrice: ${maxGpuPrice.toLocaleString()}원`);

      // CPU 필터링 실패 원인 분석
      if (cpuCandidates.length === 0) {
        const withSocket = cpus.filter(c => extractCpuSocket(c) !== "").length;
        const withScore = cpus.filter(c => getCpuScore(c) > 0).length;
        const inBudget = cpus.filter(c => c.price <= maxCpuPrice).length;
        console.error(`   CPU 분석: 소켓 있음=${withSocket}, 점수 있음=${withScore}, 예산 내=${inBudget}`);
      }

      return res.status(400).json({
        error: "INSUFFICIENT_CANDIDATES",
        message: cpuCandidates.length === 0
          ? "예산 범위 내의 CPU를 찾을 수 없습니다. 예산을 늘려주세요."
          : "예산 범위 내의 GPU를 찾을 수 없습니다. 예산을 늘려주세요.",
        debug: {
          cpuCandidates: cpuCandidates.length,
          gpuCandidates: gpuCandidates.length,
          totalCpus: cpus.length,
          totalGpus: gpus.length,
          maxCpuPrice,
          maxGpuPrice,
          budget
        }
      });
    }

    // 조합 생성 - 새로운 알고리즘: 예산 기반 적응형 선택
    const results = [];
    let attempts = 0;
    const maxAttempts = 144; // CPU 12개 × GPU 12개

    // 디버깅: 필터링 통계
    const filterStats = {
      cpuGpuTooExpensive: 0,
      bottleneck: 0, // 병목 현상으로 필터링된 조합
      remainingTooLow: 0,
      noSocket: 0,
      noBoard: 0,
      noMemory: 0,
      noPSU: 0,
      noCooler: 0,
      noStorage: 0,
      noCase: 0,
      budgetRange: 0,
      success: 0
    };

    // 병목 현상 체크 함수: CPU와 GPU의 성능 비율이 적절한지 확인
    function checkBottleneck(cpuScore, gpuScore, purpose, userBudget) {
      // 둘 다 점수가 없으면 통과 (정보 부족으로 판단 불가)
      if (cpuScore <= 0 && gpuScore <= 0) return true;

      // 하나만 점수가 있으면 통과 (부분 정보라도 허용)
      if (cpuScore <= 0 || gpuScore <= 0) return true;

      // 예산이 낮을 때는 병목 검사를 완화 (저가형 조합은 자연스럽게 병목이 있을 수 있음)
      const isVeryLowBudget = userBudget < 700000; // 70만원 미만
      const isLowBudget = userBudget < 1000000; // 100만원 미만
      const isMidBudget = userBudget >= 1000000 && userBudget < 3000000; // 100만원~300만원 (중간 예산)

      // CPU와 GPU 점수를 정규화 (0-1 범위로 변환하여 비교)
      // 일반적인 PassMark 점수 범위: 5,000 ~ 80,000
      // 일반적인 3DMark 점수 범위: 3,000 ~ 60,000
      // 정규화를 위해 점수를 비율로 변환
      const cpuRatio = Math.min(cpuScore / 80000, 1); // PassMark 최대값 기준
      const gpuRatio = Math.min(gpuScore / 60000, 1); // 3DMark 최대값 기준

      // 용도별 적절한 CPU:GPU 비율 (기본값 - 더 유연하게 설정)
      const baseRatios = {
        "게임용": { min: 0.4, max: 2.5 }, // 게임은 GPU가 중요하므로 더 유연하게
        "작업용": { min: 0.7, max: 2.0 }, // 작업은 CPU가 더 중요하지만 유연하게
        "사무용": { min: 0.3, max: 3.0 }, // 사무용은 매우 유연함
        "가성비": { min: 0.5, max: 2.0 }, // 가성비는 균형 중요하지만 유연하게
      };

      let ratio = baseRatios[purpose] || baseRatios["가성비"];

      // 예산에 따라 병목 기준 완화
      if (isVeryLowBudget) {
        // 매우 낮은 예산: 병목 검사 거의 해제 (극단적인 불균형만 필터링)
        ratio = { min: 0.2, max: 4.0 };
      } else if (isLowBudget) {
        // 낮은 예산: 병목 검사 완화
        ratio = {
          min: Math.max(0.3, ratio.min * 0.6), // 최소값 40% 완화
          max: Math.min(3.5, ratio.max * 1.5), // 최대값 50% 완화
        };
      } else if (isMidBudget) {
        // 중간 예산: 약간 완화 (150만원도 여기에 포함)
        ratio = {
          min: Math.max(0.35, ratio.min * 0.8), // 최소값 20% 완화
          max: Math.min(3.0, ratio.max * 1.3), // 최대값 30% 완화
        };
      }

      // CPU 대비 GPU 비율 계산 (gpuRatio / cpuRatio)
      const performanceRatio = gpuRatio / (cpuRatio || 0.1); // 0으로 나누기 방지

      // 비율이 적절한 범위 내에 있는지 확인
      return performanceRatio >= ratio.min && performanceRatio <= ratio.max;
    }

    for (const cpu of cpuCandidates) {
      for (const gpu of gpuCandidates) {
        attempts++;
        if (attempts > maxAttempts) break;

        // 병목 현상 체크: CPU와 GPU 성능 비율이 적절한지 확인
        const cpuScore = getCpuScore(cpu);
        const gpuScore = getGpuScore(gpu);

        if (!checkBottleneck(cpuScore, gpuScore, purpose, budget)) {
          filterStats.bottleneck++;
          // 디버깅: 처음 몇 개만 로그 출력 (너무 많으면 스킵)
          if (filterStats.bottleneck <= 3) {
            const cpuRatio = Math.min(cpuScore / 80000, 1);
            const gpuRatio = Math.min(gpuScore / 60000, 1);
            const perfRatio = gpuRatio / (cpuRatio || 0.1);
            console.log(`   병목 필터: CPU=${cpu.name} (${cpuScore}), GPU=${gpu.name} (${gpuScore}), 비율=${perfRatio.toFixed(2)}`);
          }
          continue;
        }

        const cpuGpuCost = cpu.price + gpu.price;
        const targetTotalBudget = budget * 1.0; // 목표 총 예산: 예산의 100% (정확히 맞춤)
        const targetOtherPartsBudget = targetTotalBudget - cpuGpuCost; // 나머지 부품에 할당할 예산

        // CPU+GPU가 목표 예산의 70%를 초과하면 스킵 (나머지 부품을 위해 여유 확보)
        if (cpuGpuCost > targetTotalBudget * 0.70) {
          filterStats.cpuGpuTooExpensive++;
          continue;
        }

        // 나머지 부품 예산이 너무 적으면 스킵 (최소 15만원 이상 필요)
        if (targetOtherPartsBudget < 150000) {
          filterStats.remainingTooLow++;
          continue;
        }

        // 메인보드 선택 (소켓 호환 강화)
        const cpuSocket = extractCpuSocket(cpu);
        if (!cpuSocket) {
          filterStats.noSocket++;
          continue;
        }

        // 나머지 부품 예산 배분 (목표 예산 기준)
        const boardBudget = targetOtherPartsBudget * 0.20; // 메인보드: 20%
        const memoryBudget = targetOtherPartsBudget * 0.15; // 메모리: 15%
        const psuBudget = targetOtherPartsBudget * 0.12; // PSU: 12%
        const coolerBudget = targetOtherPartsBudget * 0.08; // 쿨러: 8%
        const storageBudget = targetOtherPartsBudget * 0.25; // 스토리지: 25%
        const caseBudget = targetOtherPartsBudget * 0.20; // 케이스: 20%

        const compatibleBoards = boards.filter(b => {
          const bSocket = extractBoardSocket(b);
          // 소켓이 반드시 호환되어야 함
          if (!isSocketCompatible(cpuSocket, bSocket)) return false;
          // 목표 예산 범위 내
          return b.price <= boardBudget * 1.5 && b.price >= 30000; // 목표의 1.5배까지 허용, 최소 3만원
        });
        if (compatibleBoards.length === 0) {
          filterStats.noBoard++;
          // 디버깅: 왜 메인보드가 없는지 확인
          if (filterStats.noBoard <= 5) { // 처음 5개만 로그
            const allBoards = boards.filter(b => {
              const bSocket = extractBoardSocket(b);
              return isSocketCompatible(cpuSocket, bSocket);
            });
            const priceFiltered = allBoards.filter(b => {
              return b.price <= boardBudget * 1.5 && b.price >= 30000;
            });
            console.log(`⚠️ 메인보드 없음: CPU ${cpu.name} (소켓: ${cpuSocket})`);
            console.log(`   소켓 호환 메인보드: ${allBoards.length}개`);
            console.log(`   가격 조건 통과: ${priceFiltered.length}개`);
            if (allBoards.length > 0 && priceFiltered.length === 0) {
              const prices = allBoards.map(b => b.price).sort((a, b) => a - b);
              console.log(`   메인보드 가격 범위: ${prices[0]}원 ~ ${prices[prices.length - 1]}원`);
              console.log(`   예상 범위: 30000원 ~ ${Math.round(boardBudget * 1.5)}원 (목표: ${Math.round(boardBudget)}원)`);
            }
          }
          continue;
        }

        // 목표 예산에 맞는 메인보드 선택
        const board = compatibleBoards.sort((a, b) => {
          const aDiff = Math.abs(a.price - boardBudget);
          const bDiff = Math.abs(b.price - boardBudget);
          return aDiff - bDiff; // 목표 예산에 가장 가까운 것
        })[0];

        // 메모리 선택 (DDR 호환, 용도별 적절한 용량과 가격)
        const boardDdr = extractDdrType(board.info || board.specSummary || "");
        const remainingAfterBoard = targetOtherPartsBudget - board.price;

        // 용도별 메모리 용량 요구사항 (단계적으로 완화)
        let memoryCapacityReq = purpose === "작업용" ? 32 : purpose === "게임용" ? 16 : 16;

        // 첫 번째 시도: 이상적인 용량
        let compatibleMemories = memories.filter(m => {
          // 메모리-메인보드 호환성 체크 (DDR 타입 + 속도)
          if (!isMemoryCompatible(m, board)) {
            return false;
          }

          const capacity = extractMemoryCapacity(m);
          // 적절한 용량 + 목표 예산 범위 내
          return capacity >= memoryCapacityReq &&
            m.price <= memoryBudget * 2.0 && // 목표의 2배까지 허용 (완화)
            m.price >= 30000;
        });

        // 두 번째 시도: 용량 요구사항 완화 (작업용인 경우만)
        if (compatibleMemories.length === 0 && purpose === "작업용") {
          memoryCapacityReq = 16; // 32GB → 16GB로 완화
          compatibleMemories = memories.filter(m => {
            if (!isMemoryCompatible(m, board)) {
              return false;
            }
            const capacity = extractMemoryCapacity(m);
            return capacity >= memoryCapacityReq &&
              m.price <= memoryBudget * 2.5 && // 더 완화된 가격 범위
              m.price >= 30000;
          });
        }

        // 세 번째 시도: 호환성 체크 완화 (DDR 타입만 체크)
        if (compatibleMemories.length === 0) {
          const boardDdrType = extractDdrType(board.info || board.specSummary || "");
          compatibleMemories = memories.filter(m => {
            const memoryDdr = extractDdrType(m.name || m.info || "");
            // DDR 타입만 체크 (속도는 무시)
            if (boardDdrType && memoryDdr && boardDdrType !== memoryDdr) {
              return false;
            }
            const capacity = extractMemoryCapacity(m);
            return capacity >= Math.max(8, memoryCapacityReq * 0.5) && // 최소 8GB 또는 요구사항의 50%
              m.price <= memoryBudget * 3.0 && // 더 넓은 가격 범위
              m.price >= 30000;
          });
        }

        if (compatibleMemories.length === 0) {
          filterStats.noMemory++;
          continue;
        }

        // 용량 우선, 같은 용량이면 목표 예산에 가까운 것
        const memory = compatibleMemories.sort((a, b) => {
          const aCap = extractMemoryCapacity(a);
          const bCap = extractMemoryCapacity(b);
          if (aCap !== bCap) return bCap - aCap; // 용량 우선
          const aDiff = Math.abs(a.price - memoryBudget);
          const bDiff = Math.abs(b.price - memoryBudget);
          return aDiff - bDiff; // 목표 예산에 가까운 것
        })[0];

        // CPU/GPU TDP 추출
        const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
        const gpuTdp = extractTdp(gpu.info || "");
        const totalTdp = cpuTdp + gpuTdp + 100;

        // PSU 선택 (전력 충분 + 목표 예산 고려)
        const remainingAfterMemory = targetOtherPartsBudget - board.price - memory.price;
        const compatiblePsus = psus.filter(p => {
          const psuWattage = extractTdp(p.name || p.info || "");
          return psuWattage >= totalTdp * 1.2 &&
            p.price <= psuBudget * 1.5 && // 목표의 1.5배까지 허용
            p.price >= 40000; // 최소 4만원
        });
        if (compatiblePsus.length === 0) {
          filterStats.noPSU++;
          continue;
        }

        // 목표 예산에 맞는 PSU 선택
        const psu = compatiblePsus.sort((a, b) => {
          const aDiff = Math.abs(a.price - psuBudget);
          const bDiff = Math.abs(b.price - psuBudget);
          return aDiff - bDiff;
        })[0];

        // 쿨러 선택 (소켓 + TDP 호환성 필수 + 목표 예산 고려)
        const remainingAfterPsu = remainingAfterMemory - psu.price;

        const compatibleCoolers = coolers.filter(c => {
          // 호환성 체크
          if (!isCoolerCompatible(c, cpuSocket, cpuTdp)) return false;
          // 목표 예산 범위 내
          return c.price <= coolerBudget * 1.5 && c.price >= 15000;
        });
        if (compatibleCoolers.length === 0) {
          filterStats.noCooler++;
          continue;
        }

        // TDP 여유와 목표 예산의 균형
        const cooler = compatibleCoolers.sort((a, b) => {
          const aSpecs = parseCoolerSpecs(a);
          const bSpecs = parseCoolerSpecs(b);
          // TDP 여유가 더 큰 것 우선
          if (cpuTdp > 0 && aSpecs.tdpW > 0 && bSpecs.tdpW > 0) {
            const aMargin = aSpecs.tdpW - cpuTdp;
            const bMargin = bSpecs.tdpW - cpuTdp;
            if (Math.abs(aMargin - bMargin) > 20) {
              return bMargin - aMargin; // 여유가 더 큰 것
            }
          }
          // 같은 여유면 목표 예산에 가까운 것
          const aDiff = Math.abs(a.price - coolerBudget);
          const bDiff = Math.abs(b.price - coolerBudget);
          return aDiff - bDiff;
        })[0];

        // 스토리지 선택 (목표 예산 고려 + 남은 예산 조정)
        const remainingAfterCooler = remainingAfterPsu - cooler.price;
        // 남은 예산을 고려하여 스토리지 예산 조정
        const adjustedStorageBudget = Math.min(storageBudget * 1.2, remainingAfterCooler * 0.6);
        const compatibleStorages = storages.filter(s => {
          return s.price <= adjustedStorageBudget && s.price >= 50000;
        });
        if (compatibleStorages.length === 0) {
          filterStats.noStorage++;
          continue;
        }
        // 목표 예산에 맞는 스토리지 선택 (용량도 고려)
        const storage = compatibleStorages.sort((a, b) => {
          const aDiff = Math.abs(a.price - storageBudget);
          const bDiff = Math.abs(b.price - storageBudget);
          return aDiff - bDiff;
        })[0];

        // 케이스 선택 (목표 예산 고려 + 남은 예산 조정)
        const remainingAfterStorage = remainingAfterCooler - storage.price;
        // 남은 예산을 모두 활용 (최소 3만원 이상)
        const adjustedCaseBudget = Math.max(remainingAfterStorage, 30000);
        const compatibleCases = cases.filter(c => {
          return c.price <= adjustedCaseBudget && c.price >= 30000;
        });
        if (compatibleCases.length === 0) {
          filterStats.noCase++;
          continue;
        }
        // 남은 예산을 적절히 활용하는 케이스 선택
        const idealCasePrice = Math.min(adjustedCaseBudget * 0.8, caseBudget);
        const caseItem = compatibleCases.sort((a, b) => {
          const aDiff = Math.abs(a.price - idealCasePrice);
          const bDiff = Math.abs(b.price - idealCasePrice);
          return aDiff - bDiff;
        })[0];

        // 총 가격 계산
        const totalPrice = cpu.price + gpu.price + memory.price + board.price +
          psu.price + cooler.price + storage.price + caseItem.price;

        // 예산 범위 체크 (85-115%)
        if (totalPrice < minBudget || totalPrice > maxBudget) {
          filterStats.budgetRange++;
          // 디버깅: 예산 범위 문제 확인
          if (filterStats.budgetRange <= 5) { // 처음 5개만 로그
            console.log(`⚠️ 예산 범위 초과: ${totalPrice.toLocaleString()}원`);
            console.log(`   예산: ${budget.toLocaleString()}원 (범위: ${minBudget.toLocaleString()}원 ~ ${maxBudget.toLocaleString()}원)`);
            console.log(`   CPU: ${cpu.name} (${cpu.price.toLocaleString()}원)`);
            console.log(`   GPU: ${gpu.name} (${gpu.price.toLocaleString()}원)`);
            console.log(`   메인보드: ${board.name} (${board.price.toLocaleString()}원)`);
            console.log(`   메모리: ${memory.name} (${memory.price.toLocaleString()}원)`);
            console.log(`   PSU: ${psu.name} (${psu.price.toLocaleString()}원)`);
            console.log(`   쿨러: ${cooler.name} (${cooler.price.toLocaleString()}원)`);
            console.log(`   스토리지: ${storage.name} (${storage.price.toLocaleString()}원)`);
            console.log(`   케이스: ${caseItem.name} (${caseItem.price.toLocaleString()}원)`);
          }
          continue;
        }

        filterStats.success++;

        // 점수 계산
        const score = getCpuScore(cpu) * weight.cpu + getGpuScore(gpu) * weight.gpu;

        results.push({
          cpu, gpu, memory, board, psu, cooler, storage, case: caseItem,
          totalPrice, score,
          cpuSocket, boardDdr,
          totalTdp,
        });

        // 50개 조합이 생성되면 중단
        if (results.length >= 50) break;
      }
      if (results.length >= 50) break;
    }

    console.log(`🎉 조합 생성 완료: ${results.length}개 (${attempts}번 시도)`);
    console.log(`📊 필터링 통계:`, filterStats);

    if (results.length === 0) {
      console.error(`❌ 조합 생성 실패: ${attempts}번 시도, 결과 0개`);
      console.error(`   필터링 통계:`, filterStats);

      return res.status(400).json({
        error: "NO_VALID_COMBINATIONS",
        message: "예산에 맞는 조합을 찾을 수 없습니다. 예산을 늘리거나 다른 용도를 선택해보세요.",
        debug: {
          budget,
          purpose,
          attempts,
          filterStats,
          cpuCandidates: cpuCandidates.length,
          gpuCandidates: gpuCandidates.length,
          suggestions: [
            "예산을 10% 이상 늘려보세요",
            "다른 용도(가성비, 사무용)를 선택해보세요",
            "CPU와 GPU의 가격대를 조정해보세요"
          ]
        }
      });
    }

    // 점수 순 정렬
    results.sort((a, b) => b.score - a.score);

    // 3가지 빌드 선택: 가성비, 균형, 고성능
    const builds = [];

    // 1. 가성비: 가격 대비 점수가 가장 높은 것
    const costEfficient = results
      .slice()
      .sort((a, b) => (b.score / b.totalPrice) - (a.score / a.totalPrice))[0];
    builds.push({ label: "가성비", ...costEfficient });

    // 2. 균형: 중간 가격대
    const midPrice = budget * 0.85;
    const balanced = results
      .slice()
      .sort((a, b) => Math.abs(a.totalPrice - midPrice) - Math.abs(b.totalPrice - midPrice))[0];
    if (balanced && balanced !== costEfficient) {
      builds.push({ label: "균형", ...balanced });
    }

    // 3. 고성능: 점수가 가장 높은 것
    const highPerf = results[0];
    if (highPerf && highPerf !== costEfficient && highPerf !== balanced) {
      builds.push({ label: "고성능", ...highPerf });
    }

    // 중복 제거 후 부족하면 추가
    const uniqueBuilds = Array.from(new Set(builds.map(b => b.cpu.name + b.gpu.name)))
      .map(key => builds.find(b => b.cpu.name + b.gpu.name === key));

    while (uniqueBuilds.length < 3 && uniqueBuilds.length < results.length) {
      const next = results.find(r =>
        !uniqueBuilds.some(b => b.cpu.name === r.cpu.name && b.gpu.name === r.gpu.name)
      );
      if (next) {
        uniqueBuilds.push({
          label: uniqueBuilds.length === 1 ? "균형" : "고성능",
          ...next
        });
      } else {
        break;
      }
    }

    // 추천 근거
    const reasons = [
      `${purpose} 용도에 최적화된 구성`,
      `예산 ${budget.toLocaleString()}원으로 ${uniqueBuilds.length}가지 조합 추천`,
      `${results.length}개 조합 중 최적 선택`,
    ];

    // AI 평가 생성 (각 빌드에 대해)
    console.log("🤖 AI 견적 평가 생성 중...");
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
            formFactor: "ATX",
          },
        };

        // AI 평가 생성
        const aiEvaluation = await generateBuildEvaluation(buildData, purpose, budget);
        return {
          ...buildData,
          aiEvaluation: aiEvaluation.evaluation || "",
          aiStrengths: aiEvaluation.strengths || [],
          aiRecommendations: aiEvaluation.recommendations || [],
          aiError: aiEvaluation.error || null, // 에러 정보 전달
        };
      })
    );

    console.log("✅ AI 견적 평가 완료");

    res.json({
      builds: buildsWithAI,
      recommended: uniqueBuilds[1]?.label || uniqueBuilds[0]?.label,
      message: `${purpose} 용도로 ${uniqueBuilds.length}가지 조합을 추천합니다!`,
      reasons,
    });

  } catch (error) {
    console.error("❌ 추천 오류:", error);
    console.error("스택:", error.stack);

    // 프로덕션 환경에서는 상세 에러 정보 숨김
    const isProduction = process.env.NODE_ENV === 'production';

    res.status(500).json({
      error: "RECOMMENDATION_ERROR",
      message: isProduction
        ? "추천 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
        : error.message,
      ...(isProduction ? {} : { stack: error.stack })
    });
  }
});

export default router;
