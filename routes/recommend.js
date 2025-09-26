// routes/recommend.js (REWRITE)
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

/* ---------------------- 유틸: 파싱/정규화 ---------------------- */
const SOCKET_RX = /(AM5|AM4|LGA\s?1700|LGA\s?1200|s?TRX4|TR4)/i;
const DDR_RX = /\bDDR(4|5)\b/i;
const CAP_RX = /(\d+)\s?GB/i;

function parseSocketFromBoardInfo(info = "") {
  const m = (info || "").match(SOCKET_RX);
  return m ? m[1].replace(/\s+/g, "").toUpperCase() : "";
}

// CPU 이름에서 세대 기반으로 소켓 추정 (간단 휴리스틱)
function inferCpuSocket(cpuName = "") {
  const n = cpuName.toUpperCase();

  // AMD
  if (/RYZEN\s*(7|9|5|3)\s*7\d{3}/i.test(n)) return "AM5";   // Ryzen 7000 시리즈
  if (/RYZEN/i.test(n)) return "AM4";

  // Intel (간단 규칙)
  if (/I[3579]-1[2-4]\d{3}/i.test(n) || /1[2-4]\d{3}K?F?/i.test(n)) return "LGA1700"; // 12~14세대
  if (/I[3579]-10\d{3}|I[3579]-11\d{3}/i.test(n) || /10\d{3}|11\d{3}/i.test(n)) return "LGA1200";

  return "";
}

function parseDdrFromMemory(info = "") {
  const m = (info || "").match(DDR_RX);
  return m ? `DDR${m[1]}`.toUpperCase() : "";
}

function parseCapacityGB(info = "") {
  const m = (info || "").match(CAP_RX);
  return m ? Number(m[1]) : 0;
}

function parseDdrFromBoard(info = "") {
  // 간단: Socket 만 저장되는 경우가 있어 DDR 판단이 어려움 → 이름/info에 DDR5 언급 시 사용
  if (/DDR5/i.test(info)) return "DDR5";
  if (/DDR4/i.test(info)) return "DDR4";
  return ""; // 못 찾으면 용인(메모리 쪽 기준으로 필터)
}

/* ---------------------- 유틸: 가격/점수 ---------------------- */
function recentMedianPrice(part = {}) {
  const hist = Array.isArray(part.priceHistory) ? part.priceHistory : [];
  if (hist.length === 0) return Number(part.price) || 0;
  const last = hist.slice(-7); // 최근 7개 기록
  const arr = last.map((x) => Number(x.price)).filter((n) => n > 0);
  if (!arr.length) return Number(part.price) || 0;
  arr.sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

function gpuPerf(part = {}) {
  // 우선 passmarkscore 사용, 없으면 timeSpyScore를 근사 가중(스케일링)하여 사용
  const pm = Number(part?.benchmarkScore?.passmarkscore) || 0;
  if (pm) return pm;
  const ts = Number(part?.benchmarkScore?.timeSpyScore) || 0;
  return Math.round(ts * 5); // 경험적 스케일 (필요 시 조정)
}

function cpuPerf(part = {}) {
  return Number(part?.benchmarkScore?.passmarkscore) ||
         Number(part?.benchmarkScore?.cinebenchMulti) || 0;
}

function valueScore(score, price) {
  if (!price || price <= 0) return 0;
  return score / price;
}

/* ---------------------- 목적별 프로파일 ---------------------- */
const PURPOSE = {
  "게임용": {
    budgetGuide: { cpu: [0.2, 0.35], gpu: [0.45, 0.6], memory: [0.05, 0.15], motherboard: [0.05, 0.12] },
    weights: { cpu: 1.0, gpu: 1.4, mem: 0.2, board: 0.1 },
    minMemGB: 16, recMemGB: 32, preferDDR: "DDR5",
  },
  "작업용": {
    budgetGuide: { cpu: [0.35, 0.55], gpu: [0.2, 0.4], memory: [0.1, 0.25], motherboard: [0.05, 0.15] },
    weights: { cpu: 1.4, gpu: 1.0, mem: 0.3, board: 0.1 },
    minMemGB: 32, recMemGB: 64, preferDDR: "DDR5",
  },
  "가성비": {
    budgetGuide: { cpu: [0.25, 0.4], gpu: [0.3, 0.5], memory: [0.05, 0.15], motherboard: [0.05, 0.12] },
    weights: { cpu: 1.1, gpu: 1.1, mem: 0.2, board: 0.1 },
    minMemGB: 16, recMemGB: 32, preferDDR: "", // DDR4도 허용
  },
};

function pickProfile(purpose) {
  return PURPOSE[purpose] || PURPOSE["가성비"];
}

/* ---------------------- 호환성/필터 ---------------------- */
function isCpuBoardCompatible(cpu, board) {
  const cpuSock = inferCpuSocket(cpu?.name || "");
  const mbSock = parseSocketFromBoardInfo(board?.info || "");
  if (!cpuSock || !mbSock) return true; // 정보 없는 경우는 일단 허용
  return cpuSock === mbSock;
}

function isMemBoardCompatible(mem, board) {
  const memDdr = parseDdrFromMemory(mem?.info || "");
  if (!memDdr) return true; // 정보 없으면 허용
  const mbDdr = parseDdrFromBoard(board?.info || "");
  if (!mbDdr) return true;  // 보드 info에 DDR 표기가 없을 수 있음 → 허용
  return memDdr === mbDdr;
}

/* ---------------------- 조합/스코어링 ---------------------- */
function comboScore({ cpu, gpu, memory, board, purpose, totalPrice }) {
  const prof = pickProfile(purpose);
  const cScore = cpuPerf(cpu);
  const gScore = gpuPerf(gpu);
  const mGB = parseCapacityGB(memory?.info || "");
  const w = prof.weights;

  // 기본 성능 가중합
  let score = w.cpu * cScore + w.gpu * gScore;

  // 메모리 가점 (용량, 선호 DDR)
  if (mGB >= prof.minMemGB) score += w.mem * mGB * 50; // 32GB면 +1600 정도
  if (prof.preferDDR) {
    const memDdr = parseDdrFromMemory(memory?.info || "");
    if (memDdr && memDdr === prof.preferDDR) score += 400;
  }

  // 병목 패널티 (너무 한쪽으로 치우치면 감점)
  const ratio = (cScore && gScore) ? Math.max(cScore / gScore, gScore / cScore) : 1;
  if (ratio > 2.0) score *= 0.85; // 큰 병목이면 15% 감점
  else if (ratio > 1.6) score *= 0.93;

  // 가격당 성능 가중
  score += valueScore(score, totalPrice) * 2000;

  return Math.round(score);
}

function withinBudgetGuide(partPrice, totalBudget, [low, high]) {
  const ratio = partPrice / totalBudget;
  return ratio >= low && ratio <= high;
}

/* ---------------------- 메인 로직 ---------------------- */
router.post("/", async (req, res) => {
  try {
    const { budget = 0, purpose = "가성비", allowOver = 0 } = req.body;
    const totalBudget = Number(budget);
    const overRatio = Math.min(Math.max(Number(allowOver) || 0, 0), 0.1); // 최대 +10% 허용

    const db = getDB();
    const [cpus, gpus, mems, boards] = await Promise.all([
      db.collection("parts").find({ category: "cpu", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "gpu", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "memory", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "motherboard", price: { $gt: 0 } }).toArray(),
    ]);

    const prof = pickProfile(purpose);

    // 가격 안정화: 중위값 사용
    for (const x of [...cpus, ...gpus, ...mems, ...boards]) {
      x._price = recentMedianPrice(x);
    }

    // 1차 후보 필터: 예산 가이드 대략 만족하는 파트만 빠르게 필터
    const cpuCand = cpus.filter(c => withinBudgetGuide(c._price, totalBudget, prof.budgetGuide.cpu));
    const gpuCand = gpus.filter(g => withinBudgetGuide(g._price, totalBudget, prof.budgetGuide.gpu));
    const memCand = mems.filter(m => withinBudgetGuide(m._price, totalBudget, prof.budgetGuide.memory));
    const brdCand = boards.filter(b => withinBudgetGuide(b._price, totalBudget, prof.budgetGuide.motherboard));

    const combos = [];
    const budgetCap = totalBudget * (1 + overRatio);

    // 간단 브루트포스 (후보 폭 넓으면 샘플링/정렬 후 상위 N만 사용하도록 최적화 가능)
    for (const cpu of cpuCand) {
      for (const board of brdCand) {
        if (!isCpuBoardCompatible(cpu, board)) continue;

        for (const memory of memCand) {
          if (!isMemBoardCompatible(memory, board)) continue;

          for (const gpu of gpuCand) {
            const totalPrice = cpu._price + gpu._price + memory._price + board._price;
            if (totalPrice > budgetCap) continue;

            // 목적별 메모리 최소 용량 만족 못하면 제외
            const memGB = parseCapacityGB(memory?.info || "");
            if (memGB < prof.minMemGB) continue;

            const score = comboScore({ cpu, gpu, memory, board, purpose, totalPrice });
            combos.push({ cpu, gpu, memory, motherboard: board, totalPrice, score });
          }
        }
      }
    }

    if (!combos.length) {
      return res.status(200).json({ builds: [], message: "예산/호환 조건에 맞는 조합을 찾지 못했습니다." });
    }

    // 3가지 빌드 추출: 가성비/균형/고성능
    // - 가성비: scorePerPrice 기준 상위
    // - 균형: score와 가격 균형(중간 지점)
    // - 고성능: score 상위
    const byScore = [...combos].sort((a, b) => b.score - a.score);
    const byValue = [...combos].sort((a, b) => (b.score / b.totalPrice) - (a.score / a.totalPrice));

    const perf = byScore[0];
    const value = byValue[0];
    const balanced = byScore[Math.floor(byScore.length / 3)] || byScore[0];

    // 중복 방지
    const uniq = [];
    const seen = new Set();
    for (const x of [value, balanced, perf]) {
      const key = `${x.cpu?.name}|${x.gpu?.name}|${x.memory?.name}|${x.motherboard?.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(x);
      }
    }

    const builds = uniq.map((b, i) => {
      const tag = i === 0 ? "가성비" : i === 1 ? "균형" : "고성능";
      const reasons = [];

      // 간단 근거 설명
      const cpuSock = inferCpuSocket(b.cpu.name);
      const mbSock = parseSocketFromBoardInfo(b.motherboard.info);
      if (cpuSock && mbSock) reasons.push(`소켓 호환: ${cpuSock} / ${mbSock}`);
      const memDdr = parseDdrFromMemory(b.memory.info);
      const mbDdr = parseDdrFromBoard(b.motherboard.info) || "(표기없음)";
      if (memDdr) reasons.push(`메모리 규격: ${memDdr}, 보드: ${mbDdr}`);
      reasons.push(`목적 가중치 반영(${purpose}): CPU/GPU/메모리 비중 최적화`);
      reasons.push(`가격 안정화(중위가) 기준 합계: ${b.totalPrice.toLocaleString()}원`);

      return {
        label: tag,
        totalPrice: b.totalPrice,
        score: b.score,
        parts: {
          cpu: pickFields(b.cpu),
          gpu: pickFields(b.gpu),
          memory: pickFields(b.memory),
          motherboard: pickFields(b.motherboard),
        },
        reasons,
      };
    });

    return res.json({ builds });

  } catch (err) {
    console.error("❌ [POST /recommend] error:", err);
    res.status(500).json({ error: "추천 실패" });
  }
});

function pickFields(p) {
  if (!p) return null;
  return {
    name: p.name,
    category: p.category,
    price: p._price || p.price,
    image: p.image,
    info: p.info,
    benchmarkScore: p.benchmarkScore || null,
  };
}

export default router;
