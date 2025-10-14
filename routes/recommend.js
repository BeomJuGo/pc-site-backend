// routes/recommend.js (완전 개선 + 디버깅 버전)
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

/* ==================== 유틸: 파싱 ==================== */

// CPU에서 소켓 추출 (DB의 specSummary 또는 이름 기반)
function extractCpuSocket(cpu) {
  const text = `${cpu.name} ${cpu.specSummary || ""}`.toUpperCase();
  if (/AM5|B650|X670|A620/i.test(text)) return "AM5";
  if (/AM4|B550|X570|A520/i.test(text)) return "AM4";
  if (/LGA\s?1700|Z790|B760|H770|Z690|B660/i.test(text)) return "LGA1700";
  if (/LGA\s?1200|Z590|B560|H570/i.test(text)) return "LGA1200";
  
  // CPU 이름 기반 추론
  if (/RYZEN\s*[579]\s*7[0-9]{3}/i.test(text)) return "AM5";
  if (/RYZEN/i.test(text)) return "AM4";
  if (/I[3579]-1[3-4]\d{3}|1[3-4]\d{3}K?F?/i.test(text)) return "LGA1700";
  if (/I[3579]-1[0-2]\d{3}|1[0-2]\d{3}K?F?/i.test(text)) return "LGA1200";
  
  return "";
}

// 메인보드에서 소켓 추출
function extractBoardSocket(board) {
  const text = `${board.info || ""} ${board.specSummary || ""}`.toUpperCase();
  if (/AM5/i.test(text)) return "AM5";
  if (/AM4/i.test(text)) return "AM4";
  if (/LGA\s?1700/i.test(text)) return "LGA1700";
  if (/LGA\s?1200/i.test(text)) return "LGA1200";
  return "";
}

// 메인보드에서 DDR 타입 추출
function extractBoardDDR(board) {
  const text = `${board.info || ""} ${board.specSummary || ""}`.toUpperCase();
  if (/DDR5/i.test(text)) return "DDR5";
  if (/DDR4/i.test(text)) return "DDR4";
  return "";
}

// 메모리에서 DDR 타입 추출
function extractMemoryDDR(memory) {
  const text = `${memory.info || ""} ${memory.specSummary || ""}`.toUpperCase();
  if (/DDR5/i.test(text)) return "DDR5";
  if (/DDR4/i.test(text)) return "DDR4";
  return "";
}

// 메모리 용량 추출 (GB)
function extractMemoryCapacity(memory) {
  const text = `${memory.name || ""} ${memory.info || ""}`.toUpperCase();
  const match = text.match(/(\d+)\s*GB/i);
  return match ? parseInt(match[1]) : 0;
}

// CPU TDP 추정 (specSummary나 이름 기반)
function estimateCpuTDP(cpu) {
  const name = cpu.name.toUpperCase();
  
  // 고성능 CPU
  if (/7950X|7900X|13900K|14900K|7800X3D/i.test(name)) return 170;
  if (/7700X|7600X|13700K|14700K|12900K/i.test(name)) return 125;
  if (/5800X|5900X|12700K|13600K/i.test(name)) return 105;
  if (/5600X|12600K|7500F/i.test(name)) return 65;
  
  // 기본값
  if (/I9|RYZEN\s*9/i.test(name)) return 125;
  if (/I7|RYZEN\s*7/i.test(name)) return 95;
  if (/I5|RYZEN\s*5/i.test(name)) return 65;
  
  return 65; // 기본값
}

// GPU TDP 추정
function estimateGpuTDP(gpu) {
  const name = gpu.name.toUpperCase();
  
  // RTX 40 시리즈
  if (/4090/i.test(name)) return 450;
  if (/4080/i.test(name)) return 320;
  if (/4070\s*TI/i.test(name)) return 285;
  if (/4070/i.test(name)) return 200;
  if (/4060\s*TI/i.test(name)) return 165;
  if (/4060/i.test(name)) return 115;
  
  // RTX 30 시리즈
  if (/3090/i.test(name)) return 350;
  if (/3080/i.test(name)) return 320;
  if (/3070/i.test(name)) return 220;
  if (/3060/i.test(name)) return 170;
  
  // AMD RX
  if (/7900\s*XTX/i.test(name)) return 355;
  if (/7900\s*XT/i.test(name)) return 300;
  if (/7800\s*XT/i.test(name)) return 263;
  if (/7700\s*XT/i.test(name)) return 245;
  if (/7600/i.test(name)) return 165;
  
  return 200; // 기본값
}

// 케이스 폼팩터 추출
function extractCaseFormFactors(caseItem) {
  const specs = caseItem.specs || {};
  return specs.formFactor || [];
}

// 메인보드 폼팩터 추출
function extractBoardFormFactor(board) {
  const text = `${board.name || ""} ${board.info || ""}`.toUpperCase();
  if (/E-ATX|EATX/i.test(text)) return "E-ATX";
  if (/ATX/i.test(text) && !/MINI|MICRO|M-ATX/i.test(text)) return "ATX";
  if (/M-ATX|MATX|MICRO\s*ATX/i.test(text)) return "mATX";
  if (/MINI-ITX|ITX/i.test(text)) return "Mini-ITX";
  return "ATX"; // 기본값
}

/* ==================== 호환성 체크 ==================== */

// 1. CPU ↔ Motherboard 소켓
function isSocketCompatible(cpu, board) {
  const cpuSocket = extractCpuSocket(cpu);
  const boardSocket = extractBoardSocket(board);
  if (!cpuSocket || !boardSocket) return true; // 정보 없으면 일단 허용
  return cpuSocket === boardSocket;
}

// 2. Memory ↔ Motherboard DDR
function isDDRCompatible(memory, board) {
  const memDDR = extractMemoryDDR(memory);
  const boardDDR = extractBoardDDR(board);
  if (!memDDR || !boardDDR) return true;
  return memDDR === boardDDR;
}

// 3. Motherboard ↔ Case 폼팩터
function isFormFactorCompatible(board, caseItem) {
  const boardFF = extractBoardFormFactor(board);
  const caseFF = extractCaseFormFactors(caseItem);
  if (!caseFF.length) return true;
  return caseFF.includes(boardFF);
}

// 4. GPU ↔ Case 길이
function isGpuSizeCompatible(gpu, caseItem) {
  const specs = caseItem.specs || {};
  const maxGpuLength = specs.maxGpuLength || 350;
  
  // GPU 길이 추정 (일반적인 값)
  const gpuName = gpu.name.toUpperCase();
  let gpuLength = 300; // 기본값
  
  if (/4090|3090|7900\s*XTX/i.test(gpuName)) gpuLength = 330;
  else if (/4080|3080|7900\s*XT/i.test(gpuName)) gpuLength = 310;
  else if (/4070|3070|7800/i.test(gpuName)) gpuLength = 290;
  
  return gpuLength <= maxGpuLength;
}

// 5. Cooler ↔ Case 높이
function isCoolerHeightCompatible(cooler, caseItem) {
  const coolerSpecs = cooler.specs || {};
  const caseSpecs = caseItem.specs || {};
  
  const coolerHeight = coolerSpecs.height || 160;
  const maxCoolerHeight = caseSpecs.maxCpuCoolerHeight || 160;
  
  return coolerHeight <= maxCoolerHeight;
}

// 6. PSU ↔ Case 길이 & 폼팩터
function isPsuCompatible(psu, caseItem) {
  const caseSpecs = caseItem.specs || {};
  const maxPsuLength = caseSpecs.maxPsuLength || 180;
  
  // PSU 길이는 대부분 표준 (ATX: 140mm, SFX: 100mm)
  const psuInfo = psu.info || "";
  const psuLength = /SFX/i.test(psuInfo) ? 100 : 140;
  
  return psuLength <= maxPsuLength;
}

// 7. CPU TDP ↔ Cooler TDP
function isCoolerTDPSufficient(cpu, cooler) {
  const cpuTDP = estimateCpuTDP(cpu);
  const coolerSpecs = cooler.specs || {};
  const coolerTDP = coolerSpecs.tdpRating || 150;
  
  return coolerTDP >= cpuTDP;
}

// 8. CPU ↔ Cooler 소켓
function isCoolerSocketCompatible(cpu, cooler) {
  const cpuSocket = extractCpuSocket(cpu);
  const coolerSpecs = cooler.specs || {};
  const coolerSockets = coolerSpecs.socketSupport || [];
  
  if (!cpuSocket || !coolerSockets.length) return true;
  return coolerSockets.includes(cpuSocket);
}

// 9. 전력 체크 (PSU 용량)
function isPowerSufficient(cpu, gpu, psu) {
  const cpuTDP = estimateCpuTDP(cpu);
  const gpuTDP = estimateGpuTDP(gpu);
  const totalTDP = cpuTDP + gpuTDP + 50; // +50W (메모리, 보드 등)
  
  // PSU 용량 추출
  const psuInfo = psu.info || psu.name || "";
  const wattMatch = psuInfo.match(/(\d+)\s*W/i);
  const psuWattage = wattMatch ? parseInt(wattMatch[1]) : 0;
  
  // PSU는 총 전력의 1.3배 이상 권장
  return psuWattage >= totalTDP * 1.3;
}

/* ==================== 성능 점수 ==================== */

function getCpuScore(cpu) {
  const bench = cpu.benchmarkScore || {};
  return bench.passmarkscore || bench.cinebenchMulti || 0;
}

function getGpuScore(gpu) {
  const bench = gpu.benchmarkScore || {};
  return bench["3dmarkscore"] || 0;
}

function getMemoryScore(memory) {
  const capacity = extractMemoryCapacity(memory);
  const isDDR5 = extractMemoryDDR(memory) === "DDR5";
  return capacity * (isDDR5 ? 1.2 : 1.0);
}

/* ==================== 용도별 프로파일 ==================== */

const PROFILES = {
  "게임용": {
    budget: { cpu: 0.25, gpu: 0.50, memory: 0.08, board: 0.06, psu: 0.04, cooler: 0.03, storage: 0.03, case: 0.01 },
    weights: { cpu: 1.0, gpu: 1.5, memory: 0.3 },
    minMemory: 16,
    recMemory: 32,
    preferDDR: "DDR5",
    storageMin: 500,
    storageRec: 1000,
    storageType: "NVMe"
  },
  "작업용": {
    budget: { cpu: 0.40, gpu: 0.25, memory: 0.12, board: 0.08, psu: 0.05, cooler: 0.04, storage: 0.05, case: 0.01 },
    weights: { cpu: 1.5, gpu: 0.8, memory: 0.5 },
    minMemory: 32,
    recMemory: 64,
    preferDDR: "DDR5",
    storageMin: 1000,
    storageRec: 2000,
    storageType: "NVMe"
  },
  "사무용": {
    budget: { cpu: 0.30, gpu: 0.15, memory: 0.10, board: 0.08, psu: 0.05, cooler: 0.03, storage: 0.04, case: 0.05, remaining: 0.20 },
    weights: { cpu: 1.0, gpu: 0.3, memory: 0.2 },
    minMemory: 8,
    recMemory: 16,
    preferDDR: "",
    storageMin: 256,
    storageRec: 500,
    storageType: "SATA"
  },
  "가성비": {
    budget: { cpu: 0.28, gpu: 0.35, memory: 0.08, board: 0.06, psu: 0.04, cooler: 0.03, storage: 0.03, case: 0.03, remaining: 0.10 },
    weights: { cpu: 1.0, gpu: 1.2, memory: 0.2 },
    minMemory: 16,
    recMemory: 32,
    preferDDR: "",
    storageMin: 500,
    storageRec: 1000,
    storageType: "any"
  }
};

function getProfile(purpose) {
  return PROFILES[purpose] || PROFILES["가성비"];
}

/* ==================== 조합 스코어링 ==================== */

function calculateComboScore({ cpu, gpu, memory, board, psu, cooler, storage, caseItem, purpose, totalPrice }) {
  const profile = getProfile(purpose);
  const weights = profile.weights;
  
  const cpuScore = getCpuScore(cpu);
  const gpuScore = getGpuScore(gpu);
  const memScore = getMemoryScore(memory);
  
  let score = weights.cpu * cpuScore + weights.gpu * gpuScore + weights.memory * memScore;
  
  const memCapacity = extractMemoryCapacity(memory);
  if (memCapacity >= profile.recMemory) score += 500;
  else if (memCapacity >= profile.minMemory) score += 200;
  
  if (profile.preferDDR === "DDR5" && extractMemoryDDR(memory) === "DDR5") {
    score += 300;
  }
  
  const storageSpecs = storage.specs || {};
  const storageCapacity = storageSpecs.capacity || 0;
  if (storageCapacity >= profile.storageRec) score += 200;
  else if (storageCapacity >= profile.storageMin) score += 100;
  
  if (profile.storageType === "NVMe" && storageSpecs.interface === "NVMe") {
    score += 150;
  }
  
  if (cpuScore && gpuScore) {
    const ratio = Math.max(cpuScore / gpuScore, gpuScore / cpuScore);
    if (ratio > 2.5) score *= 0.80;
    else if (ratio > 1.8) score *= 0.90;
  }
  
  if (totalPrice > 0) {
    const valueRatio = score / totalPrice;
    score += valueRatio * 50000;
  }
  
  const cpuTDP = estimateCpuTDP(cpu);
  const gpuTDP = estimateGpuTDP(gpu);
  const totalTDP = cpuTDP + gpuTDP;
  if (totalTDP < 300) score += 100;
  
  return Math.round(score);
}

/* ==================== 가격 안정화 ==================== */

function getStablePrice(part) {
  const hist = part.priceHistory || [];
  if (hist.length === 0) return part.price || 0;
  
  const recent = hist.slice(-7).map(h => h.price).filter(p => p > 0);
  if (!recent.length) return part.price || 0;
  
  recent.sort((a, b) => a - b);
  const mid = Math.floor(recent.length / 2);
  return recent.length % 2 ? recent[mid] : Math.round((recent[mid - 1] + recent[mid]) / 2);
}

/* ==================== 🆕 디버깅 유틸 ==================== */

function logPartSample(parts, category, limit = 3) {
  console.log(`\n📦 [${category}] 샘플 (상위 ${limit}개):`);
  parts.slice(0, limit).forEach((part, i) => {
    const price = part._price || part.price || 0;
    const score = category === "cpu" ? getCpuScore(part) : 
                  category === "gpu" ? getGpuScore(part) : 0;
    console.log(`   ${i+1}. ${part.name.substring(0, 50)} - ${price.toLocaleString()}원 ${score ? `(점수: ${score.toLocaleString()})` : ''}`);
    if (part.specs) {
      console.log(`      specs: ${JSON.stringify(part.specs).substring(0, 100)}...`);
    }
  });
}

function extractPsuWattage(psu) {
  const text = psu.info || psu.name || "";
  const match = text.match(/(\d+)\s*W/i);
  return match ? parseInt(match[1]) : 0;
}

/* ==================== 메인 추천 로직 (디버깅 강화) ==================== */

router.post("/", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { budget = 1000000, purpose = "가성비", allowOver = 0 } = req.body;
    const totalBudget = Number(budget);
    const overRatio = Math.min(Math.max(Number(allowOver) || 0, 0), 0.15);
    const budgetCap = totalBudget * (1 + overRatio);
    
    const profile = getProfile(purpose);
    const db = getDB();
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`💰 AI 추천 시작`);
    console.log(`   예산: ${totalBudget.toLocaleString()}원 (최대: ${budgetCap.toLocaleString()}원)`);
    console.log(`   용도: ${purpose}`);
    console.log(`   초과 허용: ${(overRatio * 100).toFixed(1)}%`);
    console.log(`${'='.repeat(70)}\n`);
    
    // 🆕 1단계: 모든 부품 로드
    console.log(`📥 1단계: 데이터베이스에서 부품 로드 중...`);
    const loadStart = Date.now();
    
    const [cpus, gpus, memories, boards, psus, coolers, storages, cases] = await Promise.all([
      db.collection("parts").find({ category: "cpu", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "gpu", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "memory", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "motherboard", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "psu", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "cooler", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "storage", price: { $gt: 0 } }).toArray(),
      db.collection("parts").find({ category: "case", price: { $gt: 0 } }).toArray(),
    ]);
    
    console.log(`✅ 로드 완료 (${Date.now() - loadStart}ms)`);
    console.log(`\n📊 카테고리별 부품 수:`);
    console.log(`   🔧 CPU: ${cpus.length}개`);
    console.log(`   🎮 GPU: ${gpus.length}개`);
    console.log(`   💾 메모리: ${memories.length}개`);
    console.log(`   🔌 메인보드: ${boards.length}개`);
    console.log(`   ⚡ PSU: ${psus.length}개`);
    console.log(`   ❄️  쿨러: ${coolers.length}개`);
    console.log(`   💿 스토리지: ${storages.length}개`);
    console.log(`   📦 케이스: ${cases.length}개`);
    
    // 🆕 데이터 부족 경고
    const warnings = [];
    if (cpus.length < 10) warnings.push(`CPU (${cpus.length}개)`);
    if (gpus.length < 10) warnings.push(`GPU (${gpus.length}개)`);
    if (memories.length < 5) warnings.push(`메모리 (${memories.length}개)`);
    if (boards.length < 10) warnings.push(`메인보드 (${boards.length}개)`);
    if (psus.length < 5) warnings.push(`PSU (${psus.length}개)`);
    if (coolers.length < 5) warnings.push(`쿨러 (${coolers.length}개)`);
    if (storages.length < 5) warnings.push(`스토리지 (${storages.length}개)`);
    if (cases.length < 5) warnings.push(`케이스 (${cases.length}개)`);
    
    if (warnings.length > 0) {
      console.log(`\n⚠️  경고: 다음 카테고리의 데이터가 부족합니다:`);
      warnings.forEach(w => console.log(`   - ${w}`));
      console.log(`   → GitHub Actions에서 sync 워크플로우를 실행하세요!`);
    }
    
    // 🆕 샘플 데이터 출력
    if (cpus.length > 0) logPartSample(cpus, "CPU");
    if (gpus.length > 0) logPartSample(gpus, "GPU");
    if (psus.length > 0) logPartSample(psus, "PSU");
    
    // 🆕 2단계: 가격 안정화
    console.log(`\n💵 2단계: 가격 안정화 처리 중...`);
    for (const part of [...cpus, ...gpus, ...memories, ...boards, ...psus, ...coolers, ...storages, ...cases]) {
      part._price = getStablePrice(part);
    }
    console.log(`✅ 가격 안정화 완료`);
    
    // 🆕 3단계: 예산 기반 필터링
    console.log(`\n🔍 3단계: 예산 기반 1차 필터링...`);
    const budgetGuide = profile.budget;
    
    const cpuCand = cpus.filter(c => {
      const ratio = c._price / totalBudget;
      return ratio >= budgetGuide.cpu * 0.5 && ratio <= budgetGuide.cpu * 2.0;
    });
    
    const gpuCand = gpus.filter(g => {
      const ratio = g._price / totalBudget;
      return ratio >= budgetGuide.gpu * 0.5 && ratio <= budgetGuide.gpu * 2.0;
    });
    
    const memCand = memories.filter(m => extractMemoryCapacity(m) >= profile.minMemory);
    const boardCand = boards;
    const psuCand = psus;
    const coolerCand = coolers;
    const storageCand = storages.filter(s => {
      const specs = s.specs || {};
      return specs.capacity >= profile.storageMin;
    });
    const caseCand = cases;
    
    console.log(`\n✅ 필터링 결과:`);
    console.log(`   CPU: ${cpus.length} → ${cpuCand.length}개 (예산범위: ${(budgetGuide.cpu * 0.5 * 100).toFixed(0)}% ~ ${(budgetGuide.cpu * 2.0 * 100).toFixed(0)}%)`);
    console.log(`   GPU: ${gpus.length} → ${gpuCand.length}개 (예산범위: ${(budgetGuide.gpu * 0.5 * 100).toFixed(0)}% ~ ${(budgetGuide.gpu * 2.0 * 100).toFixed(0)}%)`);
    console.log(`   메모리: ${memories.length} → ${memCand.length}개 (최소 ${profile.minMemory}GB)`);
    console.log(`   메인보드: ${boards.length}개 (필터 없음)`);
    console.log(`   PSU: ${psus.length}개 (필터 없음)`);
    console.log(`   쿨러: ${coolers.length}개 (필터 없음)`);
    console.log(`   스토리지: ${storages.length} → ${storageCand.length}개 (최소 ${profile.storageMin}GB)`);
    console.log(`   케이스: ${cases.length}개 (필터 없음)`);
    
    // 🆕 필터 후 데이터 부족 체크
    if (cpuCand.length === 0 || gpuCand.length === 0) {
      console.log(`\n❌ 치명적 오류: CPU 또는 GPU 후보가 없습니다!`);
      return res.json({
        builds: [],
        message: `예산 범위 내 부품을 찾을 수 없습니다. CPU 후보: ${cpuCand.length}개, GPU 후보: ${gpuCand.length}개`
      });
    }
    
    // 🆕 4단계: 상위 부품 선택
    console.log(`\n🏆 4단계: 성능 기반 상위 부품 선택...`);
    const topCPUs = cpuCand.sort((a, b) => getCpuScore(b) - getCpuScore(a)).slice(0, 20);
    const topGPUs = gpuCand.sort((a, b) => getGpuScore(b) - getGpuScore(a)).slice(0, 20);
    
    console.log(`   선택된 CPU: ${topCPUs.length}개 (최고 점수: ${getCpuScore(topCPUs[0]).toLocaleString()})`);
    console.log(`   선택된 GPU: ${topGPUs.length}개 (최고 점수: ${getGpuScore(topGPUs[0]).toLocaleString()})`);
    
    // 🆕 5단계: 조합 생성
    console.log(`\n🔄 5단계: 호환 조합 생성 중...`);
    const combos = [];
    const maxCombos = 50000;
    let checked = 0;
    
    // 🆕 호환성 실패 통계
    const compatFails = {
      socket: 0,
      ddr: 0,
      power: 0,
      coolerSocket: 0,
      coolerTDP: 0,
      formFactor: 0,
      gpuSize: 0,
      coolerHeight: 0,
      psuCompat: 0,
      budget: 0
    };
    
    const comboStart = Date.now();
    let lastLog = comboStart;
    
    for (const cpu of topCPUs) {
      for (const gpu of topGPUs) {
        for (const board of boardCand.slice(0, 15)) {
          if (!isSocketCompatible(cpu, board)) {
            compatFails.socket++;
            continue;
          }
          
          for (const memory of memCand.slice(0, 10)) {
            if (!isDDRCompatible(memory, board)) {
              compatFails.ddr++;
              continue;
            }
            
            for (const psu of psuCand.slice(0, 10)) {
              if (!isPowerSufficient(cpu, gpu, psu)) {
                compatFails.power++;
                continue;
              }
              
              for (const cooler of coolerCand.slice(0, 10)) {
                if (!isCoolerSocketCompatible(cpu, cooler)) {
                  compatFails.coolerSocket++;
                  continue;
                }
                if (!isCoolerTDPSufficient(cpu, cooler)) {
                  compatFails.coolerTDP++;
                  continue;
                }
                
                for (const storage of storageCand.slice(0, 8)) {
                  for (const caseItem of caseCand.slice(0, 8)) {
                    checked++;
                    
                    // 🆕 진행상황 로그 (5초마다)
                    if (Date.now() - lastLog > 5000) {
                      console.log(`   진행: ${checked.toLocaleString()}개 체크, ${combos.length}개 조합 발견...`);
                      lastLog = Date.now();
                    }
                    
                    if (checked > maxCombos) break;
                    
                    if (!isFormFactorCompatible(board, caseItem)) {
                      compatFails.formFactor++;
                      continue;
                    }
                    if (!isGpuSizeCompatible(gpu, caseItem)) {
                      compatFails.gpuSize++;
                      continue;
                    }
                    if (!isCoolerHeightCompatible(cooler, caseItem)) {
                      compatFails.coolerHeight++;
                      continue;
                    }
                    if (!isPsuCompatible(psu, caseItem)) {
                      compatFails.psuCompat++;
                      continue;
                    }
                    
                    const totalPrice = cpu._price + gpu._price + memory._price + board._price + 
                                     psu._price + cooler._price + storage._price + caseItem._price;
                    
                    if (totalPrice > budgetCap) {
                      compatFails.budget++;
                      continue;
                    }
                    
                    const score = calculateComboScore({
                      cpu, gpu, memory, board, psu, cooler, storage, caseItem, purpose, totalPrice
                    });
                    
                    combos.push({
                      cpu, gpu, memory, motherboard: board, psu, cooler, storage, case: caseItem,
                      totalPrice, score
                    });
                  }
                  if (checked > maxCombos) break;
                }
                if (checked > maxCombos) break;
              }
              if (checked > maxCombos) break;
            }
            if (checked > maxCombos) break;
          }
          if (checked > maxCombos) break;
        }
        if (checked > maxCombos) break;
      }
      if (checked > maxCombos) break;
    }
    
    console.log(`\n✅ 조합 생성 완료 (${Date.now() - comboStart}ms)`);
    console.log(`   체크: ${checked.toLocaleString()}개`);
    console.log(`   발견: ${combos.length.toLocaleString()}개`);
    
    // 🆕 호환성 실패 통계 출력
    console.log(`\n📉 호환성 체크 실패 통계:`);
    const totalFails = Object.values(compatFails).reduce((a, b) => a + b, 0);
    console.log(`   총 실패: ${totalFails.toLocaleString()}회`);
    Object.entries(compatFails).forEach(([key, value]) => {
      if (value > 0) {
        const percent = ((value / totalFails) * 100).toFixed(1);
        console.log(`   - ${key}: ${value.toLocaleString()}회 (${percent}%)`);
      }
    });
    
    if (combos.length === 0) {
      console.log(`\n❌ 최종 결과: 호환 조합 없음`);
      console.log(`\n💡 해결 방법:`);
      console.log(`   1. 예산을 늘리세요 (현재: ${totalBudget.toLocaleString()}원)`);
      console.log(`   2. 다른 용도를 선택하세요 (현재: ${purpose})`);
      console.log(`   3. GitHub Actions에서 sync 워크플로우를 실행하여 부품 데이터를 업데이트하세요`);
      
      return res.json({
        builds: [],
        message: "예산과 호환 조건에 맞는 조합을 찾을 수 없습니다. 예산을 늘리거나 조건을 완화해주세요.",
        debug: {
          checked,
          found: combos.length,
          compatibilityFails: compatFails,
          candidateCounts: {
            cpu: cpuCand.length,
            gpu: gpuCand.length,
            memory: memCand.length,
            motherboard: boardCand.length,
            psu: psuCand.length,
            cooler: coolerCand.length,
            storage: storageCand.length,
            case: caseCand.length
          }
        }
      });
    }
    
    // 🆕 6단계: 3가지 빌드 추출
    console.log(`\n🎯 6단계: 최적 빌드 추출 중...`);
    const byScore = [...combos].sort((a, b) => b.score - a.score);
    const byValue = [...combos].sort((a, b) => (b.score / b.totalPrice) - (a.score / a.totalPrice));
    const byPrice = [...combos].sort((a, b) => a.totalPrice - b.totalPrice);
    
    const builds = [];
    const seen = new Set();
    
    // 1. 가성비 빌드
    for (const combo of byValue) {
      const key = `${combo.cpu.name}|${combo.gpu.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        builds.push({ ...combo, label: "가성비" });
        console.log(`   ✅ 가성비: ${combo.cpu.name.substring(0, 20)} + ${combo.gpu.name.substring(0, 20)} = ${combo.totalPrice.toLocaleString()}원`);
        break;
      }
    }
    
    // 2. 균형 빌드
    const midPrice = totalBudget * 0.85;
    const balanced = byScore.find(c => {
      const key = `${c.cpu.name}|${c.gpu.name}`;
      return !seen.has(key) && Math.abs(c.totalPrice - midPrice) < totalBudget * 0.2;
    }) || byScore[Math.floor(byScore.length / 2)];
    
    if (balanced) {
      const key = `${balanced.cpu.name}|${balanced.gpu.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        builds.push({ ...balanced, label: "균형" });
        console.log(`   ✅ 균형: ${balanced.cpu.name.substring(0, 20)} + ${balanced.gpu.name.substring(0, 20)} = ${balanced.totalPrice.toLocaleString()}원`);
      }
    }
    
    // 3. 고성능 빌드
    for (const combo of byScore) {
      const key = `${combo.cpu.name}|${combo.gpu.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        builds.push({ ...combo, label: "고성능" });
        console.log(`   ✅ 고성능: ${combo.cpu.name.substring(0, 20)} + ${combo.gpu.name.substring(0, 20)} = ${combo.totalPrice.toLocaleString()}원`);
        break;
      }
    }
    
    // 🆕 7단계: 응답 포맷팅
    console.log(`\n📤 7단계: 응답 생성 중...`);
    const response = builds.map(build => {
      const reasons = generateReasons(build, purpose);
      
      return {
        label: build.label,
        totalPrice: build.totalPrice,
        score: build.score,
        parts: {
          cpu: formatPart(build.cpu),
          gpu: formatPart(build.gpu),
          memory: formatPart(build.memory),
          motherboard: formatPart(build.motherboard),
          psu: formatPart(build.psu),
          cooler: formatPart(build.cooler),
          storage: formatPart(build.storage),
          case: formatPart(build.case)
        },
        compatibility: {
          socket: `${extractCpuSocket(build.cpu)} ↔ ${extractBoardSocket(build.motherboard)}`,
          ddr: `${extractMemoryDDR(build.memory)} ↔ ${extractBoardDDR(build.motherboard)}`,
          power: `${estimateCpuTDP(build.cpu) + estimateGpuTDP(build.gpu)}W → ${extractPsuWattage(build.psu)}W PSU`,
          formFactor: `${extractBoardFormFactor(build.motherboard)} → ${extractCaseFormFactors(build.case).join(", ")}`
        },
        reasons
      };
    });
    
    const totalTime = Date.now() - startTime;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ 추천 완료!`);
    console.log(`   총 소요시간: ${totalTime}ms (${(totalTime/1000).toFixed(1)}초)`);
    console.log(`   생성된 빌드: ${response.length}개`);
    console.log(`${'='.repeat(70)}\n`);
    
    return res.json({ builds: response });
    
  } catch (err) {
    console.error("\n❌ 추천 실패:", err);
    console.error("스택 트레이스:", err.stack);
    return res.status(500).json({ 
      error: "추천 처리 중 오류 발생", 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

function formatPart(part) {
  return {
    name: part.name,
    category: part.category,
    price: part._price || part.price,
    image: part.image,
    info: part.info,
    review: part.review || "",
    specSummary: part.specSummary || "",
    benchmarkScore: part.benchmarkScore || null
  };
}

function generateReasons(build, purpose) {
  const reasons = [];
  const profile = getProfile(purpose);
  
  const cpuSocket = extractCpuSocket(build.cpu);
  const boardSocket = extractBoardSocket(build.motherboard);
  reasons.push(`✅ 소켓 호환: ${cpuSocket} ↔ ${boardSocket}`);
  
  const memDDR = extractMemoryDDR(build.memory);
  const boardDDR = extractBoardDDR(build.motherboard);
  const memCap = extractMemoryCapacity(build.memory);
  reasons.push(`✅ 메모리: ${memDDR} ${memCap}GB (${profile.minMemory}GB 이상 권장)`);
  
  const totalTDP = estimateCpuTDP(build.cpu) + estimateGpuTDP(build.gpu);
  const psuWatt = extractPsuWattage(build.psu);
  reasons.push(`✅ 전력: ${totalTDP}W 소비 → ${psuWatt}W PSU (${Math.round(psuWatt/totalTDP*100)}% 여유)`);
  
  const cpuTDP = estimateCpuTDP(build.cpu);
  const coolerSpecs = build.cooler.specs || {};
  const coolerTDP = coolerSpecs.tdpRating || 0;
  reasons.push(`✅ 쿨러: CPU ${cpuTDP}W ↔ 쿨러 ${coolerTDP}W 지원`);
  
  const boardFF = extractBoardFormFactor(build.motherboard);
  reasons.push(`✅ 케이스: ${boardFF} 메인보드 지원`);
  
  if (purpose === "게임용") {
    const gpuScore = getGpuScore(build.gpu);
    reasons.push(`🎮 게이밍 최적화: GPU 성능 ${gpuScore.toLocaleString()} (높을수록 좋음)`);
  } else if (purpose === "작업용") {
    const cpuScore = getCpuScore(build.cpu);
    reasons.push(`💼 작업용 최적화: CPU 성능 ${cpuScore.toLocaleString()} (멀티코어 중시)`);
  }
  
  const storageSpecs = build.storage.specs || {};
  const storageCap = storageSpecs.capacity || 0;
  const storageType = storageSpecs.interface || "";
  reasons.push(`💾 저장공간: ${storageCap}GB ${storageType} (${profile.storageMin}GB 이상 권장)`);
  
  return reasons;
}

export default router;
