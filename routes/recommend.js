// routes/recommend.js - 개선된 추천 알고리즘
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
  return 16; // 기본값
}

function extractTdp(text = "") {
  const match = text.match(/(\d+)\s*W/i);
  return match ? parseInt(match[1]) : 0;
}

const getCpuScore = (cpu) => cpu.benchmarkScore?.passmarkscore || cpu.benchScore || 0;
const getGpuScore = (gpu) => gpu.benchmarkScore?.["3dmarkscore"] || gpu.benchScore || 0;

/* ==================== 개선된 추천 로직 ==================== */

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

    // 용도별 가중치
    const weights = {
      "사무용": { cpu: 0.4, gpu: 0.2 },
      "게임용": { cpu: 0.3, gpu: 0.6 },
      "작업용": { cpu: 0.5, gpu: 0.4 },
      "가성비": { cpu: 0.4, gpu: 0.5 },
    };
    const weight = weights[purpose] || weights["가성비"];

    // CPU/GPU 필터링 및 정렬 (가성비 순)
    const cpuCandidates = cpus
      .filter(c => getCpuScore(c) > 0)
      .sort((a, b) => (getCpuScore(b) / b.price) - (getCpuScore(a) / a.price))
      .slice(0, 8); // 상위 8개

    const gpuCandidates = gpus
      .filter(g => getGpuScore(g) > 0)
      .sort((a, b) => (getGpuScore(b) / b.price) - (getGpuScore(a) / a.price))
      .slice(0, 8); // 상위 8개

    console.log(`🔍 후보: CPU(${cpuCandidates.length}), GPU(${gpuCandidates.length})`);

    if (cpuCandidates.length === 0 || gpuCandidates.length === 0) {
      return res.status(404).json({
        message: "CPU 또는 GPU 데이터가 부족합니다.",
        debug: { cpus: cpuCandidates.length, gpus: gpuCandidates.length }
      });
    }

    // 조합 생성
    const results = [];
    let attempts = 0;
    const maxAttempts = 64; // CPU 8개 × GPU 8개

    for (const cpu of cpuCandidates) {
      for (const gpu of gpuCandidates) {
        attempts++;
        if (attempts > maxAttempts) break;

        const cpuGpuCost = cpu.price + gpu.price;
        const remaining = budget - cpuGpuCost;

        // CPU+GPU가 예산의 80%를 초과하면 스킵
        if (cpuGpuCost > budget * 0.8) continue;
        if (remaining < 200000) continue; // 최소 20만원은 남아야 함

        // 메인보드 선택 (소켓 호환)
        const cpuSocket = extractCpuSocket(cpu);
        const compatibleBoards = boards.filter(b => {
          const bSocket = extractBoardSocket(b);
          return (!cpuSocket || !bSocket || bSocket === cpuSocket) && 
                 b.price <= remaining * 0.25;
        });
        if (compatibleBoards.length === 0) continue;
        
        const board = compatibleBoards.sort((a, b) => b.price - a.price)[0]; // 가장 비싼 것

        // 메모리 선택 (DDR 호환)
        const boardDdr = extractDdrType(board.info || board.specSummary || "");
        const compatibleMemories = memories.filter(m => {
          const mDdr = extractDdrType(m.name || m.info || "");
          const capacity = extractMemoryCapacity(m);
          return (!boardDdr || !mDdr || mDdr === boardDdr) && 
                 capacity >= 8 && 
                 m.price <= remaining * 0.25;
        });
        if (compatibleMemories.length === 0) continue;
        
        const memory = compatibleMemories.sort((a, b) => 
          extractMemoryCapacity(b) - extractMemoryCapacity(a)
        )[0]; // 가장 용량 큰 것

        // PSU 선택 (전력 충분)
        const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
        const gpuTdp = extractTdp(gpu.info || "");
        const totalTdp = cpuTdp + gpuTdp + 100;
        const compatiblePsus = psus.filter(p => {
          const psuWattage = extractTdp(p.name || p.info || "");
          return psuWattage >= totalTdp * 1.2 && p.price <= remaining * 0.15;
        });
        if (compatiblePsus.length === 0) continue;
        
        const psu = compatiblePsus.sort((a, b) => a.price - b.price)[0]; // 가장 저렴한 것

        // 쿨러 선택
        const compatibleCoolers = coolers.filter(c => c.price <= remaining * 0.1);
        if (compatibleCoolers.length === 0) continue;
        const cooler = compatibleCoolers.sort((a, b) => a.price - b.price)[0];

        // 스토리지 선택
        const compatibleStorages = storages.filter(s => s.price <= remaining * 0.15);
        if (compatibleStorages.length === 0) continue;
        const storage = compatibleStorages.sort((a, b) => b.price - a.price)[0]; // 가장 비싼 것

        // 케이스 선택
        const compatibleCases = cases.filter(c => c.price <= remaining * 0.1);
        if (compatibleCases.length === 0) continue;
        const caseItem = compatibleCases.sort((a, b) => a.price - b.price)[0];

        // 총 가격 계산
        const totalPrice = cpu.price + gpu.price + memory.price + board.price + 
                          psu.price + cooler.price + storage.price + caseItem.price;

        // 예산 초과 시 스킵
        if (totalPrice > budget) continue;

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

    if (results.length === 0) {
      return res.status(404).json({
        message: "예산에 맞는 조합을 찾을 수 없습니다. 예산을 늘려주세요.",
        debug: { budget, purpose, attempts }
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

    res.json({
      builds: uniqueBuilds.map(b => ({
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
      })),
      recommended: uniqueBuilds[1]?.label || uniqueBuilds[0]?.label,
      message: `${purpose} 용도로 ${uniqueBuilds.length}가지 조합을 추천합니다!`,
      reasons,
    });

  } catch (error) {
    console.error("❌ 추천 오류:", error);
    res.status(500).json({ message: "추천 중 오류 발생", error: error.message });
  }
});

export default router;
