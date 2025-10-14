// routes/syncCPUs.js - 다나와 + cpubenchmark 통합 버전
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_CPU_URL = "https://prod.danawa.com/list/?cate=112747";
const CPUBENCHMARK_BASE = "https://www.cpubenchmark.net/multi_thread.html";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== CPU 이름 정규화 (매칭용) ==================== */
function normalizeCpuName(name) {
  let normalized = name.toUpperCase();
  
  // 1. 한글 → 영문 변환
  const koreanToEnglish = {
    "라이젠": "RYZEN",
    "라이젠7": "RYZEN 7",
    "라이젠5": "RYZEN 5",
    "라이젠9": "RYZEN 9",
    "스레드리퍼": "THREADRIPPER",
    "코어": "CORE",
    "코어I": "CORE I",
    "펜티엄": "PENTIUM",
    "셀러론": "CELERON",
    "애슬론": "ATHLON",
  };
  
  for (const [kor, eng] of Object.entries(koreanToEnglish)) {
    normalized = normalized.replace(new RegExp(kor, "gi"), eng);
  }
  
  // 2. 세대 표기 제거 (예: 5세대, 6세대, 13세대 등)
  normalized = normalized.replace(/(\d+)세대/g, "");
  
  // 3. 코드네임 제거 (괄호 안의 내용)
  normalized = normalized.replace(/\([^)]*\)/g, "");
  
  // 4. 특수문자 정리
  normalized = normalized
    .replace(/[-_]/g, " ")      // 하이픈을 공백으로
    .replace(/\s+/g, " ")       // 연속 공백 제거
    .trim();
  
  // 5. AMD/Intel 구분자 추가
  if (normalized.includes("RYZEN") || normalized.includes("THREADRIPPER") || normalized.includes("ATHLON")) {
    if (!normalized.startsWith("AMD")) {
      normalized = "AMD " + normalized;
    }
  }
  
  if (normalized.includes("CORE I") || normalized.includes("PENTIUM") || normalized.includes("CELERON")) {
    if (!normalized.startsWith("INTEL")) {
      normalized = "INTEL " + normalized;
    }
  }
  
  return normalized;
}

/* ==================== CPU 이름 매칭 (유사도 기반) ==================== */
function matchCpuNames(danawaName, benchmarkName) {
  const norm1 = normalizeCpuName(danawaName);
  const norm2 = normalizeCpuName(benchmarkName);
  
  // 1. 정확히 일치
  if (norm1 === norm2) return true;
  
  // 2. 핵심 토큰 추출 (숫자+문자 조합)
  const extractTokens = (str) => {
    // 예: "AMD RYZEN 5 7400F" → ["AMD", "RYZEN", "5", "7400F"]
    return str.split(/\s+/).filter(t => t.length > 0);
  };
  
  const tokens1 = extractTokens(norm1);
  const tokens2 = extractTokens(norm2);
  
  // 3. 핵심 토큰이 모두 포함되어 있는지 확인
  const coreTokens1 = tokens1.filter(t => /\d/.test(t)); // 숫자 포함 토큰
  const coreTokens2 = tokens2.filter(t => /\d/.test(t));
  
  if (coreTokens1.length === 0 || coreTokens2.length === 0) return false;
  
  // 4. 모든 핵심 토큰이 다른 문자열에 포함되는지 확인
  const allMatch = coreTokens1.every(t => norm2.includes(t)) &&
                   coreTokens2.every(t => norm1.includes(t));
  
  return allMatch;
}

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `CPU "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<코어/스레드/클럭/캐시>"}`;

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
          temperature: 0.4,
          messages: [
            { role: "system", content: "너는 PC 부품 전문가야. JSON만 출력해." },
            { role: "user", content: prompt },
          ],
        }),
      });

      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}") + 1;
      const parsed = JSON.parse(raw.slice(start, end));

      return {
        review: parsed.review?.trim() || "",
        specSummary: parsed.specSummary?.trim() || "",
      };
    } catch (e) {
      await sleep(800 * Math.pow(2, i));
    }
  }
  return { review: "", specSummary: "" };
}

/* ==================== CPU 정보 추출 ==================== */
function extractCpuInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const parts = [];

  // 코어/스레드
  const coreMatch = combined.match(/(\d+)코어|(\d+)\s*CORE/i);
  const threadMatch = combined.match(/(\d+)스레드|(\d+)\s*THREAD/i);
  
  if (coreMatch) {
    const cores = coreMatch[1] || coreMatch[2];
    parts.push(`${cores}코어`);
  }
  
  if (threadMatch) {
    const threads = threadMatch[1] || threadMatch[2];
    parts.push(`${threads}스레드`);
  }

  // 베이스/부스트 클럭
  const baseClockMatch = combined.match(/베이스[:\s]*(\d+\.?\d*)\s*GHz/i);
  const boostClockMatch = combined.match(/(?:부스트|최대)[:\s]*(\d+\.?\d*)\s*GHz/i);
  
  if (baseClockMatch) {
    parts.push(`베이스: ${baseClockMatch[1]}GHz`);
  }
  
  if (boostClockMatch) {
    parts.push(`부스트: ${boostClockMatch[1]}GHz`);
  }

  // 캐시
  const cacheMatch = combined.match(/(\d+)\s*MB\s*(?:캐시|CACHE)/i);
  if (cacheMatch) {
    parts.push(`캐시: ${cacheMatch[1]}MB`);
  }

  // TDP
  const tdpMatch = combined.match(/TDP[:\s]*(\d+)W/i);
  if (tdpMatch) {
    parts.push(`TDP: ${tdpMatch[1]}W`);
  }

  // 소켓
  if (/AM5/i.test(combined)) parts.push("Socket: AM5");
  else if (/AM4/i.test(combined)) parts.push("Socket: AM4");
  else if (/LGA\s?1700/i.test(combined)) parts.push("Socket: LGA1700");
  else if (/LGA\s?1200/i.test(combined)) parts.push("Socket: LGA1200");

  return parts.join(", ");
}

/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name) {
  const n = name.toUpperCase();
  if (n.includes("AMD") || n.includes("라이젠") || n.includes("RYZEN")) return "AMD";
  if (n.includes("INTEL") || n.includes("인텔") || n.includes("CORE I")) return "Intel";
  return "";
}

/* ==================== cpubenchmark 크롤링 ==================== */
async function crawlCpuBenchmark(maxPages = 5) {
  console.log(`🔍 cpubenchmark.net 크롤링 시작 (${maxPages}페이지)`);
  
  let browser;
  const benchmarks = new Map(); // CPU 이름 → 점수

  try {
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-gpu', '--no-sandbox'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = pageNum === 1 
        ? CPUBENCHMARK_BASE
        : `https://www.cpubenchmark.net/multi_thread_page${pageNum}.html`;
      
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        await sleep(1000);

        const items = await page.evaluate(() => {
          const rows = [];
          
          // cpubenchmark 사이트의 표 구조 파싱
          const table = document.querySelector('#cputable');
          if (!table) return rows;

          const trs = table.querySelectorAll('tbody tr');
          
          trs.forEach(tr => {
            const nameEl = tr.querySelector('td.prdname');
            const scoreEl = tr.querySelector('td.rsc');
            
            if (nameEl && scoreEl) {
              const name = nameEl.textContent.trim();
              const scoreText = scoreEl.textContent.trim().replace(/,/g, '');
              const score = parseInt(scoreText, 10);
              
              if (name && !isNaN(score)) {
                rows.push({ name, score });
              }
            }
          });

          return rows;
        });

        items.forEach(item => {
          benchmarks.set(item.name, item.score);
        });

        console.log(`✅ 페이지 ${pageNum}: ${items.length}개 수집 완료`);
        await sleep(1500);

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 실패:`, e.message);
      }
    }
  } catch (error) {
    console.error("❌ cpubenchmark 크롤링 실패:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`🎉 총 ${benchmarks.size}개 벤치마크 점수 수집 완료`);
  return benchmarks;
}

/* ==================== 다나와 CPU 크롤링 ==================== */
async function crawlDanawaCpus(maxPages = 15) {
  console.log(`🔍 다나와 CPU 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    // 불필요한 리소스 차단
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        if (pageNum === 1) {
          let retries = 3;
          let loaded = false;

          while (retries > 0 && !loaded) {
            try {
              console.log(`🔄 1페이지 로딩 시도 (남은 재시도: ${retries})`);
              await page.goto(DANAWA_CPU_URL, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });
              loaded = true;
            } catch (err) {
              retries--;
              if (retries === 0) throw err;
              console.log("⏳ 재시도 대기 중...");
              await sleep(3000);
            }
          }
        } else {
          const nextBtnSelector = `a.num[page="${pageNum}"]`;
          await page.waitForSelector(nextBtnSelector, { timeout: 10000 });
          await page.click(nextBtnSelector);
          await sleep(2000);
        }

        await page.waitForSelector("ul.product_list > li.prod_item", {
          timeout: 10000,
        });

        const items = await page.evaluate(() => {
          const liList = Array.from(
            document.querySelectorAll("ul.product_list > li.prod_item")
          );
          return liList.map((li) => {
            const nameEl = li.querySelector("p.prod_name a");
            const imgEl = li.querySelector("a.thumb_link img");
            const specEl = li.querySelector("div.spec_list");

            return {
              name: nameEl?.textContent?.trim() || "",
              image: imgEl?.src || "",
              spec: specEl?.textContent?.trim() || "",
            };
          });
        });

        products.push(...items.filter((p) => p.name));
        console.log(`✅ 페이지 ${pageNum}: ${items.length}개 수집 완료`);

        await sleep(2000);

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);
        
        if (pageNum === 1) {
          break;
        }
      }
    }
  } catch (error) {
    console.error("❌ 크롤링 실패:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`🎉 총 ${products.length}개 제품 수집 완료`);
  return products;
}

/* ==================== 벤치마크 점수 매칭 ==================== */
function findBenchmarkScore(cpuName, benchmarks) {
  // 1. 정확히 일치하는 이름 찾기
  if (benchmarks.has(cpuName)) {
    return benchmarks.get(cpuName);
  }

  // 2. 정규화된 이름으로 매칭
  const normalizedCpuName = normalizeCpuName(cpuName);
  
  for (const [benchName, score] of benchmarks.entries()) {
    if (matchCpuNames(cpuName, benchName)) {
      console.log(`✅ 매칭: "${cpuName}" ↔ "${benchName}" (${score}점)`);
      return score;
    }
  }

  // 3. 부분 일치 (fallback)
  const tokens = normalizedCpuName.split(/\s+/).filter(t => /\d/.test(t));
  
  for (const [benchName, score] of benchmarks.entries()) {
    const normalizedBench = normalizeCpuName(benchName);
    const allTokensMatch = tokens.every(t => normalizedBench.includes(t));
    
    if (allTokensMatch) {
      console.log(`⚠️ 부분 매칭: "${cpuName}" ↔ "${benchName}" (${score}점)`);
      return score;
    }
  }

  console.log(`❌ 매칭 실패: "${cpuName}" (정규화: "${normalizedCpuName}")`);
  return 0;
}

/* ==================== MongoDB 저장 ==================== */
async function saveToMongoDB(cpus, benchmarks, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cpu" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${cpus.length}개`);

  let inserted = 0;
  let updated = 0;
  let withScore = 0;

  for (const cpu of cpus) {
    const old = byName.get(cpu.name);
    const info = extractCpuInfo(cpu.name, cpu.spec);
    
    // 벤치마크 점수 매칭
    const benchScore = findBenchmarkScore(cpu.name, benchmarks);
    if (benchScore > 0) withScore++;

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: cpu.name,
          spec: cpu.spec,
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "cpu",
      info,
      image: cpu.image,
      manufacturer: extractManufacturer(cpu.name),
      benchScore, // 🆕 벤치마크 점수
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      updated++;
      console.log(`🔁 업데이트: ${cpu.name} (점수: ${benchScore})`);
    } else {
      await col.insertOne({
        name: cpu.name,
        ...update,
        price: 0,
        priceHistory: [],
      });
      inserted++;
      console.log(`🆕 신규 추가: ${cpu.name} (점수: ${benchScore})`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(cpus.map((c) => c.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cpu", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개`
  );
  console.log(`📊 벤치마크 점수: ${withScore}/${cpus.length}개 매칭 완료`);
  console.log(`💡 가격은 updatePrices.js로 별도 업데이트 필요`);
}

/* ==================== Express 라우터 ==================== */
router.post("/sync-cpus", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.maxPages) || 15;
    const benchPages = parseInt(req.body?.benchPages) || 5;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({
      message: `✅ CPU 동기화 시작 (다나와: ${maxPages}p, 벤치마크: ${benchPages}p, AI: ${ai})`,
    });

    setImmediate(async () => {
      try {
        console.log("\n=== CPU 동기화 시작 ===");
        
        // 1단계: cpubenchmark 점수 수집
        const benchmarks = await crawlCpuBenchmark(benchPages);
        
        // 2단계: 다나와 CPU 크롤링
        const cpus = await crawlDanawaCpus(maxPages);

        if (cpus.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        // 3단계: 저장 (벤치마크 점수 매칭 포함)
        await saveToMongoDB(cpus, benchmarks, { ai, force });
        
        console.log("🎉 CPU 동기화 완료 (제품명, 스펙, 이미지, 벤치마크)");
        console.log("💡 이제 updatePrices.js를 실행하여 가격을 업데이트하세요");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-cpus 실패", err);
    res.status(500).json({ error: "sync-cpus 실패" });
  }
});

export default router;
