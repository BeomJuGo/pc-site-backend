// routes/recommend.js - 개선된 AI 추천 시스템
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

/* ==================== 유틸리티 함수 ==================== */

// 메모리 용량 추출 (GB) - 개선됨
function extractMemoryCapacity(memory) {
  const text = `${memory.name || ""} ${memory.info || ""} ${memory.specSummary || ""}`.toUpperCase();
  
  // 다양한 패턴 지원
  const patterns = [
    /(\d+)\s*GB\s*\(/i,           // "32GB(16GBx2)" 형식
    /(\d+)\s*GB(?!\s*X)/i,        // "32GB" (X가 뒤에 없음)
    /GB\s*(\d+)/i,                // "GB 32" 형식
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const capacity = parseInt(match[1]);
      if (capacity >= 4 && capacity <= 256) { // 유효 범위 체크
        return capacity;
      }
    }
  }
  
  // 기본값 반환 (파싱 실패 시)
  console.warn(`⚠️ 메모리 용량 파싱 실패: ${memory.name}`);
  return 0;
}

// CPU 소켓 추출
function extractCpuSocket(cpu) {
  const text = `${cpu.name || ""} ${cpu.info || ""} ${cpu.specSummary || ""}`;
  const match = text.match(/(AM4|AM5|LGA\s*1700|LGA\s*1200|LGA\s*2066)/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

// 메인보드 소켓 추출
function extractBoardSocket(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`;
  const match = text.match(/(AM4|AM5|LGA\s*1700|LGA\s*1200|LGA\s*2066)/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

// 메모리 타입 추출 (DDR4/DDR5)
function extractDdrType(text = "") {
  const match = text.toUpperCase().match(/DDR([45])/);
  return match ? `DDR${match[1]}` : "";
}

// 케이스 폼팩터 추출 - 개선됨
function extractCaseFormFactors(caseItem) {
  const specs = caseItem.specs || {};
  let formFactors = specs.formFactor || [];
  
  // 🆕 formFactor가 비어있으면 name과 info에서 추출 시도
  if (formFactors.length === 0) {
    const combined = `${caseItem.name || ""} ${caseItem.info || ""}`.toUpperCase();
    
    if (/E-?ATX/i.test(combined)) formFactors.push("E-ATX");
    if (/ATX/i.test(combined) && !/MINI|MICRO|M-ATX/i.test(combined)) formFactors.push("ATX");
    if (/M-?ATX|MATX|MICRO\s*ATX/i.test(combined)) formFactors.push("mATX");
    if (/MINI-?ITX|ITX/i.test(combined)) formFactors.push("Mini-ITX");
  }
  
  // 🆕 여전히 비어있으면 케이스 타입 기반 기본값 설정
  if (formFactors.length === 0) {
    const type = (specs.type || "").toLowerCase();
    if (type.includes("빅타워") || type.includes("미들타워")) {
      formFactors = ["E-ATX", "ATX", "mATX", "Mini-ITX"]; // 대부분 지원
    } else if (type.includes("미니타워")) {
      formFactors = ["mATX", "Mini-ITX"];
    } else {
      formFactors = ["ATX", "mATX"]; // 기본값
    }
    console.log(`⚠️ 케이스 폼팩터 추론: ${caseItem.name} → ${formFactors.join(", ")}`);
  }
  
  return formFactors;
}

// 메인보드 폼팩터 추출
function extractBoardFormFactor(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`.toUpperCase();
  
  if (/E-?ATX/i.test(text)) return "E-ATX";
  if (/MINI-?ITX|ITX/i.test(text)) return "Mini-ITX";
  if (/M-?ATX|MATX|MICRO\s*ATX/i.test(text)) return "mATX";
  if (/ATX/i.test(text)) return "ATX";
  
  return "ATX"; // 기본값
}

// 폼팩터 호환성 체크 - 개선됨
function isFormFactorCompatible(board, caseItem) {
  const boardFormFactor = extractBoardFormFactor(board);
  const caseFormFactors = extractCaseFormFactors(caseItem);
  
  // 🆕 케이스가 여러 폼팩터를 지원하는지 확인
  const compatible = caseFormFactors.some(cf => {
    // 정규화
    const normalizedCase = cf.replace(/[-\s]/g, "").toUpperCase();
    const normalizedBoard = boardFormFactor.replace(/[-\s]/g, "").toUpperCase();
    
    // 직접 매칭
    if (normalizedCase === normalizedBoard) return true;
    
    // 하위 호환성 체크 (큰 케이스는 작은 보드 수용)
    const hierarchy = {
      "MINIITX": 1,
      "ITX": 1,
      "MATX": 2,
      "MICROATX": 2,
      "ATX": 3,
      "EATX": 4
    };
    
    const caseLevel = hierarchy[normalizedCase] || 3;
    const boardLevel = hierarchy[normalizedBoard] || 3;
    
    return caseLevel >= boardLevel;
  });
  
  if (!compatible) {
    console.log(`❌ 폼팩터 불일치: ${board.name} (${boardFormFactor}) ↔ ${caseItem.name} (${caseFormFactors.join("/")})`);
  }
  
  return compatible;
}

// TDP/전력 추출
function extractTdp(text = "") {
  const match = text.match(/(\d+)\s*W/i);
  return match ? parseInt(match[1]) : 0;
}

// GPU 길이 추출
function extractGpuLength(gpu) {
  const text = `${gpu.name || ""} ${gpu.info || ""}`;
  const match = text.match(/(\d+)\s*mm/i);
  return match ? parseInt(match[1]) : 300; // 기본값 300mm
}

// 쿨러 높이 추출
function extractCoolerHeight(cooler) {
  const text = `${cooler.name || ""} ${cooler.info || ""}`;
  const match = text.match(/(\d+)\s*mm/i);
  return match ? parseInt(match[1]) : 150; // 기본값 150mm
}

/* ==================== 추천 로직 ==================== */

router.post("/", async (req, res) => {
  try {
    const { budget, purpose } = req.body;
    
    if (!budget || budget < 500000) {
      return res.status(400).json({ message: "최소 예산은 50만원입니다." });
    }
    
    console.log(`\n🎯 추천 요청: 예산 ${budget.toLocaleString()}원, 용도: ${purpose}`);

    const db = getDB();
    const col = db.collection("parts");

    // 🆕 8가지 부품 모두 가져오기
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

    console.log(`📦 부품 개수: CPU(${cpus.length}), GPU(${gpus.length}), Memory(${memories.length}), Board(${boards.length}), PSU(${psus.length}), Cooler(${coolers.length}), Storage(${storages.length}), Case(${cases.length})`);

    // 🆕 각 카테고리별 최소 개수 체크
    if (cpus.length < 5 || gpus.length < 5 || memories.length < 5 || boards.length < 5) {
      return res.status(500).json({ 
        message: "부품 데이터가 부족합니다. 데이터 동기화를 실행해주세요.",
        data: { cpus: cpus.length, gpus: gpus.length, memories: memories.length, boards: boards.length }
      });
    }

    // 용도별 점수 가중치
    const scoreWeights = {
      "사무용": { cpu: 0.3, gpu: 0.1 },
      "게임용": { cpu: 0.35, gpu: 0.45 },
      "작업용": { cpu: 0.4, gpu: 0.4 },
      "가성비": { cpu: 0.35, gpu: 0.35 },
    };
    const weights = scoreWeights[purpose] || scoreWeights["가성비"];

    // CPU/GPU 후보 필터링 (용도별)
    let cpuCand = cpus.filter(c => c.benchScore > 0);
    let gpuCand = gpus.filter(g => g.benchScore > 0);

    if (purpose === "사무용") {
      cpuCand = cpuCand.filter(c => c.price <= 300000);
      gpuCand = gpuCand.filter(g => g.price <= 200000);
    }

    // 🆕 후보 개수 로깅
    console.log(`🔍 필터링 후: CPU(${cpuCand.length}), GPU(${gpuCand.length})`);

    // 성능 점수 계산
    const topCPUs = cpuCand
      .sort((a, b) => (b.benchScore / b.price) - (a.benchScore / a.price))
      .slice(0, 30); // 20 → 30으로 증가
    
    const topGPUs = gpuCand
      .sort((a, b) => (b.benchScore / b.price) - (a.benchScore / a.price))
      .slice(0, 30); // 20 → 30으로 증가

    console.log(`✨ 상위 후보: CPU(${topCPUs.length}), GPU(${topGPUs.length})`);

    const results = [];
    const compatibilityFails = {
      socket: 0,
      ddr: 0,
      formFactor: 0,
      power: 0,
      gpu: 0,
      cooler: 0,
      memory: 0,
      total: 0
    };

    // 조합 생성
    for (const cpu of topCPUs) {
      for (const gpu of topGPUs) {
        const baseCost = cpu.price + gpu.price;
        const remaining = budget - baseCost;
        
        if (remaining < 100000) continue; // 최소 10만원은 남아야 함

        const cpuSocket = extractCpuSocket(cpu);
        const cpuDdr = extractDdrType(cpu.info || cpu.specSummary || "");
        const cpuTdp = extractTdp(cpu.info || cpu.specSummary || "");
        const gpuTdp = extractTdp(gpu.info || "");
        const totalTdp = cpuTdp + gpuTdp + 100; // 기타 부품 100W
        const gpuLength = extractGpuLength(gpu);

        // 메인보드 호환 필터링
        const boardCand = boards.filter(b => {
          const bSocket = extractBoardSocket(b);
          const bDdr = extractDdrType(b.info || b.specSummary || "");
          
          const socketMatch = !cpuSocket || !bSocket || bSocket === cpuSocket;
          const ddrMatch = !cpuDdr || !bDdr || bDdr === cpuDdr;
          
          if (!socketMatch) compatibilityFails.socket++;
          if (!ddrMatch) compatibilityFails.ddr++;
          
          return socketMatch && ddrMatch && b.price <= remaining * 0.25;
        });

        if (boardCand.length === 0) continue;

        for (const board of boardCand.slice(0, 20)) { // 15 → 20으로 증가
          const boardDdr = extractDdrType(board.info || board.specSummary || "");

          // 메모리 필터링 - 개선됨
          const memCand = memories.filter(m => {
            const mDdr = extractDdrType(m.name || m.info || "");
            const capacity = extractMemoryCapacity(m);
            
            // 🆕 DDR 타입 매칭 완화
            const ddrMatch = !boardDdr || !mDdr || mDdr === boardDdr;
            
            // 🆕 용량 체크 개선
            const validCapacity = capacity >= 8; // 최소 8GB
            
            if (!ddrMatch) compatibilityFails.ddr++;
            if (!validCapacity) compatibilityFails.memory++;
            
            return ddrMatch && validCapacity && m.price <= remaining * 0.15;
          });

          // 🆕 메모리 후보 로깅
          if (memCand.length === 0) {
            console.log(`⚠️ 메모리 후보 0개: Board DDR=${boardDdr}, 예산=${(remaining * 0.15).toLocaleString()}원`);
            continue;
          }

          for (const memory of memCand.slice(0, 15)) { // 10 → 15로 증가
            const memCapacity = extractMemoryCapacity(memory);

            // PSU 필터링
            const psuCand = psus.filter(p => {
              const psuWattage = extractTdp(p.name || p.info || "");
              const sufficient = psuWattage >= totalTdp * 1.2; // 20% 여유
              
              if (!sufficient) compatibilityFails.power++;
              
              return sufficient && p.price <= remaining * 0.12;
            });

            if (psuCand.length === 0) continue;

            for (const psu of psuCand.slice(0, 12)) { // 10 → 12로 증가
              // Cooler 필터링
              const coolerCand = coolers.filter(c => c.price <= remaining * 0.08);
              if (coolerCand.length === 0) continue;

              for (const cooler of coolerCand.slice(0, 12)) { // 10 → 12로 증가
                const coolerHeight = extractCoolerHeight(cooler);

                // Storage 필터링
                const storageCand = storages.filter(s => s.price <= remaining * 0.12);
                if (storageCand.length === 0) continue;

                for (const storage of storageCand.slice(0, 10)) { // 8 → 10으로 증가
                  // Case 필터링 - 개선됨
                  const caseCand = cases.filter(c => {
                    // 폼팩터 체크
                    const formFactorOk = isFormFactorCompatible(board, c);
                    
                    // GPU 길이 체크
                    const caseSpecs = c.specs || {};
                    const maxGpuLen = caseSpecs.maxGpuLength || 400;
                    const gpuFits = gpuLength <= maxGpuLen;
                    
                    // 쿨러 높이 체크
                    const maxCoolerHeight = caseSpecs.maxCpuCoolerHeight || 180;
                    const coolerFits = coolerHeight <= maxCoolerHeight;
                    
                    if (!formFactorOk) compatibilityFails.formFactor++;
                    if (!gpuFits) compatibilityFails.gpu++;
                    if (!coolerFits) compatibilityFails.cooler++;
                    
                    return formFactorOk && gpuFits && coolerFits && c.price <= remaining * 0.1;
                  });

                  if (caseCand.length === 0) continue;

                  for (const caseItem of caseCand.slice(0, 10)) { // 8 → 10으로 증가
                    const totalPrice =
                      cpu.price +
                      gpu.price +
                      memory.price +
                      board.price +
                      psu.price +
                      cooler.price +
                      storage.price +
                      caseItem.price;

                    if (totalPrice > budget) continue;

                    const score =
                      cpu.benchScore * weights.cpu +
                      gpu.benchScore * weights.gpu;

                    results.push({
                      cpu,
                      gpu,
                      memory,
                      board,
                      psu,
                      cooler,
                      storage,
                      case: caseItem,
                      totalPrice,
                      score,
                      compatibility: {
                        socket: `${cpuSocket} ↔ ${extractBoardSocket(board)}`,
                        ddr: `${cpuDdr || boardDdr} ↔ ${extractDdrType(memory.name)}`,
                        power: `${totalTdp}W → ${extractTdp(psu.name)}W`,
                        formFactor: `${extractBoardFormFactor(board)} → ${extractCaseFormFactors(caseItem).join("/")}`,
                      },
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // 🆕 호환성 실패 통계 로깅
    console.log(`\n📊 호환성 체크 실패 통계:`);
    console.log(`   소켓 불일치: ${compatibilityFails.socket}회`);
    console.log(`   DDR 불일치: ${compatibilityFails.ddr}회`);
    console.log(`   폼팩터 불일치: ${compatibilityFails.formFactor}회`);
    console.log(`   전력 부족: ${compatibilityFails.power}회`);
    console.log(`   GPU 길이 초과: ${compatibilityFails.gpu}회`);
    console.log(`   쿨러 높이 초과: ${compatibilityFails.cooler}회`);
    console.log(`   메모리 용량 문제: ${compatibilityFails.memory}회`);

    console.log(`\n🎉 조합 생성 완료: ${results.length}개`);

    if (results.length === 0) {
      return res.status(404).json({
        message: "⚠️ 예산과 호환 조건에 맞는 조합을 찾을 수 없습니다. 예산을 늘리거나 조건을 완화해주세요.",
        debug: {
          budget: budget.toLocaleString(),
          purpose,
          candidates: {
            cpu: topCPUs.length,
            gpu: topGPUs.length,
            memory: memories.length,
            board: boards.length,
            psu: psus.length,
            cooler: coolers.length,
            storage: storages.length,
            case: cases.length,
          },
          compatibilityFails,
        },
      });
    }

    // 상위 3개 선택 (가성비/균형/고성능)
    results.sort((a, b) => b.score - a.score);

    const costEfficient = results
      .slice()
      .sort((a, b) => b.score / b.totalPrice - a.score / a.totalPrice)[0];
    
    const balanced = results[Math.floor(results.length / 2)];
    const highPerf = results[0];

    const builds = [
      { label: "가성비", ...costEfficient },
      { label: "균형", ...balanced },
      { label: "고성능", ...highPerf },
    ];

    // 추천 근거
    const reasons = [
      `${purpose} 용도에 최적화된 ${builds[1].cpu.name} CPU 사용`,
      `예산 ${budget.toLocaleString()}원 내에서 ${builds.length}가지 조합 추천`,
      `전력 ${builds[1].compatibility.power} 안정적 공급`,
      `${builds[1].compatibility.socket} 소켓 완벽 호환`,
    ];

    res.json({
      builds: builds.map(b => ({
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
        compatibility: b.compatibility,
        reasons,
      })),
      recommended: builds[1].label,
      message: `${purpose} 용도로 ${builds.length}가지 조합을 추천합니다!`,
    });

  } catch (error) {
    console.error("❌ 추천 오류:", error);
    res.status(500).json({ message: "추천 중 오류 발생", error: error.message });
  }
});

export default router;
