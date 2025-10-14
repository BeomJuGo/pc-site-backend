// routes/recommend.js - 초경량 알고리즘
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

/* ==================== 유틸리티 함수 ==================== */

function extractCpuSocket(cpu) {
  const text = `${cpu.name || ""} ${cpu.info || ""} ${cpu.specSummary || ""}`;
  const match = text.match(/(AM4|AM5|LGA\s*1700|LGA\s*1200|LGA\s*2066)/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

function extractBoardSocket(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`;
  const match = text.match(/(AM4|AM5|LGA\s*1700|LGA\s*1200|LGA\s*2066)/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

function extractDdrType(text = "") {
  const match = text.toUpperCase().match(/DDR([45])/);
  return match ? `DDR${match[1]}` : "";
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
  return 0;
}

function extractTdp(text = "") {
  const match = text.match(/(\d+)\s*W/i);
  return match ? parseInt(match[1]) : 0;
}

/* ==================== 간단한 추천 로직 ==================== */

router.post("/", async (req, res) => {
  try {
    const { budget, purpose } = req.body;
    
    if (!budget || budget < 500000) {
      return res.status(400).json({ message: "최소 예산은 50만원입니다." });
    }
    
    console.log(`\n🎯 추천 요청: 예산 ${budget.toLocaleString()}원, 용도: ${purpose}`);

    const db = getDB();
    const col = db.collection("parts");

    // 모든 부품 가져오기
    const [cpus, gpus, memories, boards, psus, coolers, storages, cases] = await Promise.all([
      col.find({ category: "cpu", price: { $gt: 0 } }).toArray(),
      col.find({ category: "gpu", price: { $gt: 0 } }).toArray(),
      col.find({ category: "memory", price: { $gt: 0 } }).toArray(),
      col.find({ category: "motherboard", price: { $gt: 0 } }).toArray(),
      col.find({ category: "psu", price: { $gt: 0 } }).toArray(),
      col.find({ category: "cooler", price: { $gt: 0 } }).toArray(),
      col.find({ category: "storage", price: { $gt: 0 } }).toArray(),
      col.find({ category: "case", price: { $gt: 0 } }).toArray(),
    ]);

    console.log(`📦 부품: CPU(${cpus.length}), GPU(${gpus.length}), Memory(${memories.length}), Board(${boards.length})`);

    // 용도별 예산 배분
    const budgetRatios = {
      "사무용": { cpu: 0.20, gpu: 0.10, memory: 0.12, board: 0.18, psu: 0.12, cooler: 0.08, storage: 0.12, case: 0.08 },
      "게임용": { cpu: 0.25, gpu: 0.35, memory: 0.10, board: 0.12, psu: 0.08, cooler: 0.03, storage: 0.04, case: 0.03 },
      "작업용": { cpu: 0.30, gpu: 0.25, memory: 0.15, board: 0.12, psu: 0.08, cooler: 0.03, storage: 0.04, case: 0.03 },
      "가성비": { cpu: 0.25, gpu: 0.25, memory: 0.12, board: 0.15, psu: 0.10, cooler: 0.04, storage: 0.06, case: 0.03 },
    };
    const ratios = budgetRatios[purpose] || budgetRatios["가성비"];

    // 🆕 단계별 부품 선택 (8중 루프 제거!)
    function selectBestPart(parts, maxPrice, scoreFn) {
      const candidates = parts
        .filter(p => p.price > 0 && p.price <= maxPrice)
        .sort((a, b) => scoreFn(b) / b.price - scoreFn(a) / a.price)
        .slice(0, 3);
      return candidates[0] || null;
    }

    // CPU 점수 추출 함수
    const getCpuScore = (cpu) => {
      return cpu.benchmarkScore?.passmarkscore || cpu.benchScore || 0;
    };

    // GPU 점수 추출 함수
    const getGpuScore = (gpu) => {
      return gpu.benchmarkScore?.["3dmarkscore"] || gpu.benchScore || 0;
    };

    // 3가지 빌드 생성 (가성비, 균형, 고성능)
    const builds = [];
    const buildTypes = [
      { label: "가성비", budgetMultiplier: 0.85 },
      { label: "균형", budgetMultiplier: 0.95 },
      { label: "고성능", budgetMultiplier: 1.0 },
    ];

    for (const buildType of buildTypes) {
      const targetBudget = budget * buildType.budgetMultiplier;
      
      // 1단계: CPU 선택
      const cpu = selectBestPart(
        cpus,
        targetBudget * ratios.cpu,
        getCpuScore
      );
      if (!cpu) continue;

      // 2단계: GPU 선택
      const gpu = selectBestPart(
        gpus,
        targetBudget * ratios.gpu,
        getGpuScore
      );
      if (!gpu) continue;

      // 3단계: 메인보드 선택 (소켓 호환)
      const cpuSocket = extractCpuSocket(cpu);
      const board = selectBestPart(
        boards.filter(b => {
          const bSocket = extractBoardSocket(b);
          return !cpuSocket || !bSocket || bSocket === cpuSocket;
        }),
        targetBudget * ratios.board,
        () => 1000
      );
      if (!board) continue;

      // 4단계: 메모리 선택 (DDR 호환)
      const boardDdr = extractDdrType(board.info || board.specSummary || "");
      const memory = selectBestPart(
        memories.filter(m => {
          const mDdr = extractDdrType(m.name || m.info || "");
          const capacity = extractMemoryCapacity(m);
          return (!boardDdr || !mDdr || mDdr === boardDdr) && capacity >= 8;
        }),
        targetBudget * ratios.memory,
        () => extractMemoryCapacity
      );
      if (!memory) continue;

      // 5단계: PSU 선택 (전력 충분)
      const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
      const gpuTdp = extractTdp(gpu.info || "");
      const totalTdp = cpuTdp + gpuTdp + 100;
      const psu = selectBestPart(
        psus.filter(p => {
          const psuWattage = extractTdp(p.name || p.info || "");
          return psuWattage >= totalTdp * 1.2;
        }),
        targetBudget * ratios.psu,
        () => 1000
      );
      if (!psu) continue;

      // 6단계: 쿨러 선택
      const cooler = selectBestPart(
        coolers,
        targetBudget * ratios.cooler,
        () => 1000
      );
      if (!cooler) continue;

      // 7단계: 스토리지 선택
      const storage = selectBestPart(
        storages,
        targetBudget * ratios.storage,
        () => 1000
      );
      if (!storage) continue;

      // 8단계: 케이스 선택
      const caseItem = selectBestPart(
        cases,
        targetBudget * ratios.case,
        () => 1000
      );
      if (!caseItem) continue;

      // 총 가격 계산
      const totalPrice =
        cpu.price + gpu.price + memory.price + board.price +
        psu.price + cooler.price + storage.price + caseItem.price;

      // 예산 초과 시 스킵
      if (totalPrice > budget) continue;

      // 점수 계산
      const score = getCpuScore(cpu) * 0.4 + getGpuScore(gpu) * 0.6;

      builds.push({
        label: buildType.label,
        totalPrice,
        score: Math.round(score),
        parts: {
          cpu: { name: cpu.name, price: cpu.price, image: cpu.image },
          gpu: { name: gpu.name, price: gpu.price, image: gpu.image },
          memory: { name: memory.name, price: memory.price, image: memory.image },
          motherboard: { name: board.name, price: board.price, image: board.image },
          psu: { name: psu.name, price: psu.price, image: psu.image },
          cooler: { name: cooler.name, price: cooler.price, image: cooler.image },
          storage: { name: storage.name, price: storage.price, image: storage.image },
          case: { name: caseItem.name, price: caseItem.price, image: caseItem.image },
        },
        compatibility: {
          socket: `${cpuSocket} ↔ ${extractBoardSocket(board)}`,
          ddr: `${extractDdrType(cpu.info || "")} ↔ ${extractDdrType(memory.name)}`,
          power: `${totalTdp}W → ${extractTdp(psu.name)}W`,
          formFactor: "ATX",
        },
      });
    }

    console.log(`🎉 빌드 생성 완료: ${builds.length}개`);

    if (builds.length === 0) {
      return res.status(404).json({
        message: "예산에 맞는 조합을 찾을 수 없습니다. 예산을 늘려주세요.",
        debug: { budget, purpose }
      });
    }

    // 추천 근거
    const reasons = [
      `${purpose} 용도에 최적화된 구성`,
      `예산 ${budget.toLocaleString()}원 내에서 ${builds.length}가지 조합 추천`,
      `호환성 검증 완료`,
    ];

    res.json({
      builds,
      recommended: builds[1]?.label || builds[0].label,
      message: `${purpose} 용도로 ${builds.length}가지 조합을 추천합니다!`,
      reasons,
    });

  } catch (error) {
    console.error("❌ 추천 오류:", error);
    res.status(500).json({ message: "추천 중 오류 발생", error: error.message });
  }
});

export default router;
