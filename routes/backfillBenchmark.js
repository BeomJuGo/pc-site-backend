// routes/backfillBenchmark.js - 벤치마크 점수 백필 스크립트
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB, connectDB } from "../db.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GPU 이름 간소화 (syncGPUs.js와 동일)
const simplifyForFilter = (name) => {
  return name
    .replace(/NVIDIA GeForce |AMD Radeon /gi, "")
    .replace(/\b(TI|XT|SUPER|PRO|Ultra|GA\d+)\b/gi, " $1")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
};

// 제품명 규칙 검증 (GTX 지원 추가)
const isValidGPUName = (name) => {
  const upper = name.toUpperCase();
  return /(RTX|RX|GTX)\s*\d{3,5}/i.test(upper);
};

// 제외해야 할 GPU (워크스테이션용 등)
// W5500은 벤치마크가 있으므로 제외하지 않음 (radeon pro는 제외하되 W5500은 허용)
const isUnwantedGPU = (name) => {
  const n = name.toLowerCase();
  // W5500은 항상 허용
  if (/w5500/.test(n)) return false;
  // 그 외 radeon pro는 제외
  if (/radeon\s*pro/i.test(n)) return true;
  // 기타 제외 항목
  return /rtx\s*4500|ada generation|titan|\bD$/i.test(n);
};

// GPU 이름 정규화 (GTX 지원 추가)
const normalizeGpuKey = (rawName = "") => {
  const n = rawName
    .toUpperCase()
    .replace(/NVIDIA GEFORCE|GEFORCE|NVIDIA|AMD RADEON|RADEON/g, "")
    .replace(/LAPTOP|MOBILE|NOTEBOOK|DESKTOP|OEM|FOUNDERS|EDITION|GDDR\d|PCI-?E|PCIE|LP|LPX|MINI|ITX|OC|DUAL|TRIPLE|TURBO|VENTUS|EAGLE|GAMING|TUF|ROG|MECH|WINDFORCE|HELLHOUND|PULSE|RED DEVIL|FIGHTER|JETSTREAM|PHOENIX|AERO|VENTURA|SPECTRIX|MERC|STEEL LEGEND|PGD|CHALLENGER|SWIFT|MIRACLE|BLACK|2048SP|38MM/g, "")
    .replace(/\b(\d+\s?GB)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 시리즈 식별 (RTX, RX, GTX, GT, Arc 지원)
  // 순서 중요: RTX/GTX를 먼저 체크 (GTX가 GT로 매칭되지 않도록)
  let series = "";
  let model = "";

  if (/RTX|GTX/.test(n)) {
    const match = /(RTX|GTX)/.exec(n);
    series = match?.[1] || "";
    // GTX1050, GTX 1050 모두 처리 (공백 유무 무관)
    const seriesEscaped = series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const modelMatch = new RegExp(`${seriesEscaped}\\s*(\\d{3,5})|${seriesEscaped}(\\d{3,5})`, 'i').exec(n);
    model = modelMatch?.[1] || modelMatch?.[2] || "";
    // 그래도 없으면 일반 숫자 패턴으로 시도
    if (!model) {
      const generalMatch = /\b(\d{3,5})\b/.exec(n);
      model = generalMatch?.[1] || "";
    }
  } else if (/ARC\s*[A-Z]?\d{3}/.test(n)) {
    // Intel Arc: Arc A310, Arc A580, Arc B580 등
    series = "ARC";
    const arcMatch = /ARC\s*([A-Z]?)(\d{3})/.exec(n);
    if (arcMatch) {
      const prefix = arcMatch[1] || "";
      const num = arcMatch[2] || "";
      model = prefix + num; // "A310", "B580" 등
    }
  } else if (/RX|W\d{4}/.test(n)) {
    // RX 시리즈 또는 Radeon PRO W5500 등
    if (/W\s*\d{4}|W\d{4}/.test(n)) {
      // Radeon PRO W5500, W 5500, W5500 -> "W 5500"으로 처리
      series = "W";
      const wMatch = /W\s*(\d{4})|W(\d{4})/.exec(n);
      model = wMatch?.[1] || wMatch?.[2] || "";
    } else {
      series = "RX";
      // RX580, RX 580 모두 처리
      const rxMatch = /RX\s*(\d{3,5})|RX(\d{3,5})/.exec(n);
      model = rxMatch?.[1] || rxMatch?.[2] || "";
    }
  } else if (/\bGT\s*\d{3,4}\b/.test(n) || /^GT\d{3,4}/.test(n)) {
    // GT 1030, GT1030, GT 710, GT710 같은 경우 (GTX는 이미 위에서 처리됨)
    series = "GT";
    const gtMatch = /\bGT\s*(\d{3,4})\b|^GT(\d{3,4})/.exec(n);
    model = gtMatch?.[1] || gtMatch?.[2] || "";
  } else if (/\bG\d{3}\b/.test(n) || /^G\d{3}/.test(n)) {
    // G210, G710 같은 매우 오래된 모델 (GT 시리즈보다 오래됨)
    // GTX가 아닌 순수 G 시리즈만 (GTX는 이미 위에서 처리됨)
    // G210, G710 등은 숫자 앞에 G가 붙어있음
    series = "G";
    const gMatch = /\bG(\d{3})\b|^G(\d{3})/.exec(n);
    model = (gMatch?.[1] || gMatch?.[2] || "").trim();
    // 모델이 없으면 직접 추출 시도
    if (!model) {
      const directMatch = n.match(/\bG(\d{3})\b/);
      if (directMatch) model = directMatch[1];
    }
  }
  const hasTi = /\bTI\b/.test(n);
  const hasSuper = /\bSUPER\b/.test(n);
  const hasXt = /\bXT\b/.test(n);
  const hasXtx = /\bXTX\b/.test(n);
  const hasGre = /\bGRE\b/.test(n);

  if (!series || !model) return "";

  const parts = [series, model];
  if (series === "RTX") {
    if (hasTi) parts.push("TI");
    if (hasSuper) parts.push("SUPER");
  } else if (series === "RX") {
    if (hasXtx) parts.push("XTX");
    else if (hasXt) parts.push("XT");
    if (hasGre) parts.push("GRE");
  } else if (series === "GTX" || series === "GT" || series === "G") {
    if (hasTi) parts.push("TI");
    if (hasSuper) parts.push("SUPER");
  } else if (series === "ARC") {
    // Arc는 접미사 없음, 그대로 유지
  } else if (series === "W") {
    // W5500 등은 접미사 없음
  }

  return parts.join(" ").trim();
};

// GPU 점수 크롤링 (topcpu.net) - syncGPUs.js와 동일
async function fetchGPUs() {
  const url = "https://www.topcpu.net/ko/gpu-r/3dmark-time-spy-desktop";
  const html = await axios.get(url).then((res) => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];
  const nameSet = new Set();

  // 크롤링 시에는 낮은 점수도 수집 (G210, GT 1030 등은 2000 미만일 수 있음)
  const isValidTimeSpyScore = (num) => num >= 500 && num <= 60000;
  const isValidTimeSpyScoreForFilter = (num) => num >= 2000 && num <= 60000;

  // 더 많은 선택자로 GPU 찾기 (크롤링 개선)
  $("div.flex.flex-col, li, tr, .flex.flex-row, div, table tbody tr, ul li").each((_, el) => {
    // 이름 추출: 더 많은 방법 시도
    let name = "";
    const link = $(el).find("a").first();
    const strong = $(el).find("strong").first();
    const td = $(el).find("td").first();

    name = (
      link.text() ||
      strong.text() ||
      td.text() ||
      $(el).text().split('\n')[0] ||
      ""
    ).trim();

    // 이름이 너무 짧거나 긴 경우 스킵 (노이즈 제거)
    if (!name || name.length < 5 || name.length > 200) return;

    let score = 0;
    // 점수 추출: 더 많은 방법 시도
    const scoreEl = $(el).find('span.font-bold, .score, .mark, td:last-child, strong').first();
    const scoreText = scoreEl.text().replace(/,/g, '').trim();
    const parsed = parseInt(scoreText, 10);
    if (!isNaN(parsed) && isValidTimeSpyScore(parsed)) {
      score = parsed;
    } else {
      // 점수가 없으면 같은 행/요소의 숫자 찾기
      const numbers = $(el).text().match(/\d{4,6}/g);
      if (numbers) {
        for (const num of numbers) {
          const numVal = parseInt(num, 10);
          if (!isNaN(numVal) && isValidTimeSpyScore(numVal)) {
            score = numVal;
            break;
          }
        }
      }
    }

    const simplified = simplifyForFilter(name);

    if (!name || !score) return;
    // 크롤링 시에는 500점 이상이면 모두 수집 (필터링은 나중에)
    if (!isValidTimeSpyScore(score)) return;

    // GPU 이름 검증 확장 (GTX, GT, G, Arc, W 시리즈도 허용)
    // 공백이 있거나 없거나 모두 허용
    // G 시리즈는 3자리 숫자 (G210, G710 등)
    const isValidName = /(RTX|RX|GTX|GT|ARC|W)\s*[A-Z]?\d{3,5}|(RTX|RX|GTX|GT|ARC|W)[A-Z]?\d{3,5}|G\s*\d{3,4}|G\d{3,4}/i.test(simplified);
    if (!isValidName) {
      // 타겟 GPU는 이름 검증 실패해도 로그 출력
      if (/GT\s*1030|GT1030|GT\s*710|GT710|G\s*210|G210|W\s*5500|W5500/i.test(name)) {
        console.log(`⚠️ 이름 검증 실패: "${name}" → simplified: "${simplified}"`);
      }
      return;
    }

    // 타겟 GPU는 isUnwantedGPU 체크 전에 로그 출력
    const isTargetGPU = /GT\s*1030|GT1030|GT\s*710|GT710|G\s*210|G210|W\s*5500|W5500/i.test(name);
    if (isTargetGPU) {
      console.log(`🔍 타겟 GPU 발견: "${name}" → 점수: ${score} → simplified: "${simplified}"`);
    }

    if (isUnwantedGPU(name)) {
      if (isTargetGPU) {
        console.log(`   ⛔ isUnwantedGPU로 제외됨`);
      }
      return;
    }

    const base = simplified.toLowerCase();
    if (nameSet.has(base)) {
      if (isTargetGPU) {
        console.log(`   ⛔ 중복으로 제외됨 (이미 수집됨)`);
      }
      return;
    }
    nameSet.add(base);

    const key = normalizeGpuKey(name);
    // 키가 생성되지 않은 경우에도 로그 출력 (디버깅용)
    const targetNames = ['GT 1030', 'GT 710', 'GT710', 'GT1030', 'G210', 'G 210', 'W5500', 'W 5500'];
    if (!key && targetNames.some(t => name.includes(t) || simplified.includes(t))) {
      console.log(`⚠️ 크롤링 중 키 생성 실패: "${name}" → simplified: "${simplified}"`);
    }

    // 키가 없어도 타겟 GPU는 수집 (나중에 키 재생성 시도)
    if (key) {
      gpuList.push({ name, score, key });
    } else if (targetNames.some(t => name.toUpperCase().includes(t.toUpperCase()) || simplified.toUpperCase().includes(t.toUpperCase()))) {
      // 키가 없어도 타겟 GPU는 수집 (나중에 키 재생성 시도)
      console.log(`⚠️ 키 없이 수집: "${name}" (점수: ${score}) → simplified: "${simplified}"`);
      // 키 재생성 시도
      let retryKey = "";
      if (/GT\s*1030|GT1030/i.test(name) || /GT\s*1030|GT1030/i.test(simplified)) retryKey = "GT 1030";
      else if (/GT\s*710|GT710/i.test(name) || /GT\s*710|GT710/i.test(simplified)) retryKey = "GT 710";
      else if (/G\s*210|G210/i.test(name) || /G\s*210|G210/i.test(simplified)) retryKey = "G 210";
      else if (/W\s*5500|W5500/i.test(name) || /W\s*5500|W5500/i.test(simplified)) retryKey = "W 5500";

      if (retryKey) {
        console.log(`   ✅ 키 재생성 성공: "${retryKey}"`);
        gpuList.push({ name, score, key: retryKey });
      } else {
        gpuList.push({ name, score, key: "" });
      }
    }
  });

  console.log(`✅ GPU 벤치마크 크롤링 완료, 유효 GPU 수: ${gpuList.length}`);

  // 타겟 GPU가 수집되었는지 확인
  const targetGpus = gpuList.filter(g =>
    /GT\s*1030|GT1030|GT\s*710|GT710|G\s*210|G210|W\s*5500|W5500/i.test(g.name)
  );
  if (targetGpus.length > 0) {
    console.log(`📋 타겟 GPU 수집 확인 (${targetGpus.length}개):`);
    targetGpus.forEach(g => {
      console.log(`   - "${g.name}" → 키: "${g.key}" → 점수: ${g.score}`);
    });
  } else {
    console.log(`⚠️ 타겟 GPU (GT 1030, GT 710, G 210, W 5500)가 크롤링되지 않았습니다.`);
  }

  return gpuList;
}

// CPU 벤치마크 크롤링 (cpubenchmark.net) - syncCPUs.js와 유사한 로직 필요
async function fetchCPUs() {
  // CPU 벤치마크는 syncCPUs.js의 crawlCpuBenchmark 함수를 참고하되,
  // 여기서는 간단한 버전으로 구현
  console.log("⚠️ CPU 벤치마크 백필은 syncCPUs를 통해 수행해주세요.");
  return [];
}

// GPU 벤치마크 점수 백필
async function backfillGPUBenchmarks() {
  await connectDB();
  const db = getDB();
  const col = db.collection("parts");

  // GPU 벤치마크 점수 가져오기
  const gpuScores = await fetchGPUs();
  // 점수 맵 구성 (정규화 키 → 최고 점수)
  // 접미사가 있는 키와 없는 키 모두 저장하여 매칭 성공률 향상
  const scoreByKey = new Map();
  for (const g of gpuScores) {
    let key = g.key || normalizeGpuKey(g.name);
    // 키가 없으면 재시도
    if (!key && g.name) {
      key = normalizeGpuKey(g.name);
    }
    // 키가 없어도 이름으로 직접 매칭 시도
    if (!key) {
      const nameMatch = g.name.match(/(GT\s*1030|GT\s*710|GT1030|GT710|G\s*210|G210|W\s*5500|W5500)/i);
      if (nameMatch) {
        const matched = nameMatch[1].toUpperCase().replace(/\s+/g, ' ');
        if (/GT\s*1030|GT1030/i.test(matched)) key = 'GT 1030';
        else if (/GT\s*710|GT710/i.test(matched)) key = 'GT 710';
        else if (/G\s*210|G210/i.test(matched)) key = 'G 210';
        else if (/W\s*5500|W5500/i.test(matched)) key = 'W 5500';
        console.log(`🔧 키 재생성: "${g.name}" → "${key}"`);
      }
    }
    if (!key) continue;
    const prev = scoreByKey.get(key) || 0;
    if (g.score > prev) scoreByKey.set(key, g.score);

    // RX/RTX 시리즈의 경우 접미사가 있는 키에서 접미사 없는 버전도 추가
    // 예: "RX 9060 XT" → "RX 9060"도 저장
    if (/^(RX|RTX)\s+\d{3,5}\s+(XT|XTX|TI|SUPER|GRE)/.test(key)) {
      const baseKey = key.replace(/\s+(XT|XTX|TI|SUPER|GRE)+/g, "").trim();
      if (baseKey && baseKey !== key) {
        const basePrev = scoreByKey.get(baseKey) || 0;
        if (g.score > basePrev) {
          scoreByKey.set(baseKey, g.score);
        }
      }
    }

    // GT, G, W 시리즈도 공백 유무와 관계없이 매칭되도록
    // 예: "GT 1030"과 "GT1030" 모두 저장
    if (/^(GT|G|W)\s+\d{3,4}$/.test(key)) {
      const noSpaceKey = key.replace(/\s+/g, "");
      if (noSpaceKey && noSpaceKey !== key) {
        const noSpacePrev = scoreByKey.get(noSpaceKey) || 0;
        if (g.score > noSpacePrev) {
          scoreByKey.set(noSpaceKey, g.score);
        }
      }
    } else if (/^(GT|G|W)\d{3,4}$/.test(key)) {
      // 공백 없는 키에서 공백 있는 버전도 추가
      const withSpaceKey = key.replace(/^(GT|G|W)(\d{3,4})$/, "$1 $2");
      if (withSpaceKey && withSpaceKey !== key) {
        const withSpacePrev = scoreByKey.get(withSpaceKey) || 0;
        if (g.score > withSpacePrev) {
          scoreByKey.set(withSpaceKey, g.score);
        }
      }
    }
  }

  // DB에서 점수가 없는 GPU 찾기
  const gpusWithoutScore = await col
    .find({
      category: "gpu",
      $or: [
        { benchmarkScore: { $exists: false } },
        { benchmarkScore: null },
        { "benchmarkScore.3dmarkscore": { $exists: false } },
      ],
    })
    .toArray();

  console.log(`\n📊 벤치마크 점수 없는 GPU: ${gpusWithoutScore.length}개`);
  console.log(`📊 매칭 가능한 벤치마크 점수: ${scoreByKey.size}개\n`);

  let matched = 0;
  let updated = 0;
  let noKey = 0;
  let noScore = 0;
  let lowScore = 0;
  // 임계값을 낮춰서 더 많은 GPU에 점수를 부여 (2000 이상이면 저장)
  const MIN_3DMARK_SCORE_TO_ATTACH = 2000;

  // 매칭 가능한 키 목록 출력 (디버깅용)
  const availableKeys = Array.from(scoreByKey.keys()).slice(0, 10);
  console.log(`📋 매칭 가능한 키 샘플 (최대 10개):`, availableKeys);

  // GT, G, W 시리즈 키만 필터링해서 출력 (디버깅용)
  const gtKeys = Array.from(scoreByKey.keys()).filter(k => /^(GT|G|W)/i.test(k));
  if (gtKeys.length > 0) {
    console.log(`📋 GT/G/W 시리즈 키 (${gtKeys.length}개):`, gtKeys.slice(0, 20));
  }

  for (const gpu of gpusWithoutScore) {
    const key = normalizeGpuKey(gpu.name);
    if (!key) {
      noKey++;
      if (noKey <= 5) {
        console.log(`⚠️ 키 생성 실패: "${gpu.name.slice(0, 50)}"`);
      }
      continue;
    }

    // 먼저 정확한 키로 매칭 시도
    let score = scoreByKey.get(key);

    // 매칭 실패 시 공백 유무 다른 버전으로 재시도 (GT, G, W 시리즈)
    if (!score && /^(GT|G|W)\s+\d{3,4}$/.test(key)) {
      const noSpaceKey = key.replace(/\s+/g, "");
      score = scoreByKey.get(noSpaceKey);
      if (score) {
        console.log(`🔍 공백 제거 매칭: "${gpu.name.slice(0, 50)}" → "${key}" → "${noSpaceKey}" (점수: ${score})`);
      }
    } else if (!score && /^(GT|G|W)\d{3,4}$/.test(key)) {
      const withSpaceKey = key.replace(/^(GT|G|W)(\d{3,4})$/, "$1 $2");
      score = scoreByKey.get(withSpaceKey);
      if (score) {
        console.log(`🔍 공백 추가 매칭: "${gpu.name.slice(0, 50)}" → "${key}" → "${withSpaceKey}" (점수: ${score})`);
      }
    }

    // 매칭 실패 시 접미사가 없는 버전으로 재시도 (RX/RTX 시리즈)
    if (!score && /^(RX|RTX)\s+\d{3,5}\s+(XT|XTX|TI|SUPER|GRE)/.test(key)) {
      const baseKey = key.replace(/\s+(XT|XTX|TI|SUPER|GRE)+/g, "").trim();
      score = scoreByKey.get(baseKey);
      if (score) {
        console.log(`🔍 접미사 제거 매칭: "${gpu.name.slice(0, 50)}" → "${key}" → "${baseKey}" (점수: ${score})`);
      }
    }

    // 여전히 매칭 실패 시 접미사가 있는 버전으로 재시도 (접미사 없는 키인 경우)
    if (!score && /^(RX|RTX)\s+\d{3,5}$/.test(key)) {
      // 가능한 접미사들로 시도
      const suffixes = ["XT", "XTX", "TI", "SUPER"];
      for (const suffix of suffixes) {
        const withSuffix = `${key} ${suffix}`;
        const candidateScore = scoreByKey.get(withSuffix);
        if (candidateScore) {
          score = candidateScore;
          console.log(`🔍 접미사 추가 매칭: "${gpu.name.slice(0, 50)}" → "${key}" → "${withSuffix}" (점수: ${score})`);
          break;
        }
      }
    }

    if (!score) {
      noScore++;
      if (noScore <= 5) {
        console.log(`⚠️ 매칭 실패: "${gpu.name.slice(0, 50)}" → 키: "${key}" (점수 없음)`);
      }
      continue;
    }

    // GT/G/W 시리즈는 더 낮은 임계값 사용 (저성능 GPU도 포함)
    const isLowEnd = /^(GT|G|W)\s*\d/.test(key) || /^(GT|G|W)\d/.test(key);
    const minScore = isLowEnd ? 500 : MIN_3DMARK_SCORE_TO_ATTACH; // GT/G/W는 500점 이상만

    if (score < minScore) {
      lowScore++;
      if (lowScore <= 5) {
        console.log(`⚠️ 점수 낮음: "${gpu.name.slice(0, 50)}" → 점수: ${score} < ${minScore} (${isLowEnd ? '저성능' : '일반'} 기준)`);
      }
      continue;
    }

    matched++;
    const update = {
      benchmarkScore: { "3dmarkscore": score },
    };

    await col.updateOne({ _id: gpu._id }, { $set: update });
    updated++;
    console.log(`✅ 업데이트: ${gpu.name.slice(0, 50)} → 키: "${key}" → 점수: ${score}`);
  }

  console.log(`\n📊 매칭 통계:`);
  console.log(`   키 생성 실패: ${noKey}개`);
  console.log(`   점수 없음: ${noScore}개`);
  console.log(`   점수 낮음: ${lowScore}개`);
  console.log(`   매칭 성공: ${matched}개`);

  console.log(`\n📊 백필 완료: ${updated}/${gpusWithoutScore.length}개 업데이트됨`);
  return { total: gpusWithoutScore.length, updated, matched };
}

// API 엔드포인트
router.post("/backfill-benchmark", async (req, res) => {
  const { category = "gpu" } = req.body || {};

  try {
    if (category === "gpu") {
      res.json({ message: "GPU 벤치마크 점수 백필 시작" });

      setImmediate(async () => {
        try {
          const result = await backfillGPUBenchmarks();
          console.log(`\n✅ GPU 벤치마크 백필 완료: ${result.updated}/${result.total}개 업데이트`);
        } catch (err) {
          console.error("❌ GPU 벤치마크 백필 실패:", err);
        }
      });
    } else {
      res.status(400).json({ error: `지원하지 않는 카테고리: ${category}` });
    }
  } catch (err) {
    console.error("❌ backfill-benchmark 실패", err);
    res.status(500).json({ error: "backfill-benchmark 실패" });
  }
});

export default router;

