// routes/syncCPUs.js - 다나와 + cpubenchmark 통합 버전 (수정)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();
// PassMark 임계값(이 미만이면 DB 저장 제외)
const MIN_PASSMARK_SCORE_FOR_SAVE = 10000;

const DANAWA_CPU_URL = "https://prod.danawa.com/list/?cate=112747";
const CPUBENCHMARK_BASE_URL = "https://www.cpubenchmark.net/multithread"; // 🆕 수정
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV_TIMEOUT = Number(process.env.PUPPETEER_NAV_TIMEOUT || 45000); // 45초로 단축

async function navigateWithFallback(page, url) {
  // 더 빠른 전략부터 시도 (domcontentloaded 우선)
  const strategies = [
    { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT },
    { waitUntil: "load", timeout: NAV_TIMEOUT },
    { waitUntil: "networkidle2", timeout: NAV_TIMEOUT },
  ];

  let lastError;
  for (const option of strategies) {
    try {
      await page.goto(url, option);
      return;
    } catch (error) {
      lastError = error;
      console.log(
        `⚠️ waitUntil=${option.waitUntil} 로딩 실패, 다음 전략으로 재시도...`
      );
      await sleep(1000); // 재시도 간격 단축
    }
  }

  throw lastError || new Error("페이지 이동 실패");
}

/* ==================== CPU 이름 정규화 (매칭용) ==================== */
function normalizeCpuName(name) {
  let normalized = name.toUpperCase();

  // 1. 세대 표기 제거 (가장 먼저!)
  normalized = normalized.replace(/[-\s]*\d+세대[-\s]*/g, " ");

  // 2. 코드네임 제거
  normalized = normalized.replace(/\([^)]*\)/g, "");

  // 3. 한글 → 영문 변환
  const replacements = {
    "라이젠": "RYZEN",
    "스레드리퍼": "THREADRIPPER",
    "애슬론": "ATHLON",
    "인텔": "INTEL",
    "코어": "CORE",
    "울트라": "ULTRA",
    "펜티엄": "PENTIUM",
    "셀러론": "CELERON",
    "제온": "XEON",
  };

  for (const [kor, eng] of Object.entries(replacements)) {
    normalized = normalized.replace(new RegExp(kor, "gi"), eng);
  }

  // 4. "시리즈2", "시리즈1" 등 제거
  normalized = normalized.replace(/시리즈\d+/gi, "");

  // 5. 하이픈을 공백으로
  normalized = normalized.replace(/[-_]/g, " ");

  // 6. ⭐ 핵심: 숫자 앞뒤에 공백 추가
  normalized = normalized.replace(/([A-Z])(\d)/g, "$1 $2");
  normalized = normalized.replace(/(\d)([A-Z])/g, "$1 $2");

  // 7. 연속된 공백을 하나로
  normalized = normalized.replace(/\s+/g, " ").trim();

  // 8. AMD/Intel 추가 (없으면)
  if (normalized.includes("RYZEN") || normalized.includes("THREADRIPPER") || normalized.includes("ATHLON")) {
    if (!normalized.startsWith("AMD")) {
      normalized = "AMD " + normalized;
    }
  }

  if (normalized.includes("CORE") || normalized.includes("PENTIUM") || normalized.includes("CELERON") || normalized.includes("XEON")) {
    if (!normalized.startsWith("INTEL")) {
      normalized = "INTEL " + normalized;
    }
  }

  return normalized;
}

/* ==================== 브랜드 추출 ==================== */
function extractBrand(name) {
  const n = name.toUpperCase();

  // 다른 브랜드 먼저 체크 (ARM, Samsung, Mediatek, Qualcomm 등)
  if (n.includes("ARM") || n.includes("SAMSUNG") || n.includes("MEDIATEK") || n.includes("QUALCOMM") || n.includes("APPLE") || n.includes("EXYNOS") || n.includes("DIMENSITY") || n.includes("SNAPDRAGON")) {
    return "OTHER"; // Intel/AMD가 아닌 다른 브랜드
  }

  if (n.includes("AMD") || n.includes("RYZEN") || n.includes("라이젠") || n.includes("THREADRIPPER") || n.includes("ATHLON") || n.includes("PHENOM") || n.includes("FX") || n.includes("EPYC")) {
    return "AMD";
  }
  if (n.includes("INTEL") || n.includes("CORE") || n.includes("인텔") || n.includes("코어") || n.includes("PENTIUM") || n.includes("펜티엄") || n.includes("CELERON") || n.includes("셀러론") || n.includes("XEON") || n.includes("제온") || n.includes("ULTR") || n.startsWith("I3 ") || n.startsWith("I5 ") || n.startsWith("I7 ") || n.startsWith("I9 ")) {
    return "Intel";
  }
  return null;
}

/* ==================== CPU 이름 매칭 ==================== */
function matchCpuNames(danawaName, benchmarkName) {
  // 브랜드 확인 - AMD와 Intel은 절대 매칭 안 됨
  const brand1 = extractBrand(danawaName);
  const brand2 = extractBrand(benchmarkName);

  if (brand1 && brand2 && brand1 !== brand2) {
    return false; // 브랜드가 다르면 매칭 안 함
  }

  const norm1 = normalizeCpuName(danawaName);
  const norm2 = normalizeCpuName(benchmarkName);

  if (norm1 === norm2) return true;

  const extractTokens = (str) => str.split(/\s+/).filter(t => t.length > 0);
  const tokens1 = extractTokens(norm1);
  const tokens2 = extractTokens(norm2);

  const coreTokens1 = tokens1.filter(t => /\d/.test(t));
  const coreTokens2 = tokens2.filter(t => /\d/.test(t));

  if (coreTokens1.length === 0 || coreTokens2.length === 0) return false;

  const allMatch = coreTokens1.every(t => norm2.includes(t)) &&
    coreTokens2.every(t => norm1.includes(t));

  return allMatch;
}

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", info: "" };
  }

  const prompt = `CPU "${name}"(스펙: ${spec})의 한줄평과 상세 스펙 설명을 JSON으로 작성: {"review":"<100자 이내>", "info":"<코어/스레드/클럭/캐시/TDP/소켓/지원 기능 등을 한 문단으로 요약>"}`;

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
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
        info: parsed.info?.trim() || "",
      };
    } catch (e) {
      await sleep(800 * Math.pow(2, i));
    }
  }
  return { review: "", info: "" };
}

/* ==================== CPU 소켓 추출 (Intel 세대 기반 추론 포함) ==================== */
function extractSocket(name = "", spec = "") {
  const combined = `${name} ${spec}`;

  // AMD 소켓
  if (/AM5/i.test(combined)) return "Socket: AM5";
  if (/AM4/i.test(combined)) return "Socket: AM4";
  if (/sTRX4/i.test(combined)) return "Socket: sTRX4";
  if (/TR4/i.test(combined)) return "Socket: TR4";
  if (/SP3/i.test(combined)) return "Socket: SP3";

  // Intel LGA 소켓 (명시적 표기)
  if (/LGA\s?1700/i.test(combined)) return "Socket: LGA1700";
  if (/LGA\s?1851/i.test(combined)) return "Socket: LGA1851"; // Arrow Lake
  if (/LGA\s?1200/i.test(combined)) return "Socket: LGA1200";
  if (/LGA\s?2066/i.test(combined)) return "Socket: LGA2066";
  if (/LGA\s?2011[-\s]?(?:3|V3)/i.test(combined)) return "Socket: LGA2011-3";
  if (/LGA\s?2011/i.test(combined)) return "Socket: LGA2011";
  if (/LGA\s?1366/i.test(combined)) return "Socket: LGA1366";
  if (/LGA\s?1151/i.test(combined)) return "Socket: LGA1151";
  if (/LGA\s?1150/i.test(combined)) return "Socket: LGA1150";
  if (/LGA\s?1155/i.test(combined)) return "Socket: LGA1155";
  if (/LGA\s?775/i.test(combined)) return "Socket: LGA775";
  if (/LGA\s?3647/i.test(combined)) return "Socket: LGA3647";
  if (/LGA\s?4677/i.test(combined)) return "Socket: LGA4677";
  if (/LGA\s?4189/i.test(combined)) return "Socket: LGA4189";

  // 일반화된 LGA 표기 추출
  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `Socket: LGA${lga[1]}`;

  // Intel 세대 기반 소켓 추론 (명시적 표기가 없을 때)
  if (/인텔|INTEL/i.test(combined)) {
    // Core Ultra 시리즈 2 (Arrow Lake): LGA1851
    if (/코어\s*울트라|CORE\s*ULTRA/i.test(combined) && /시리즈\s*2|SERIES\s*2|애로우레이크|ARROW\s*LAKE/i.test(combined)) {
      return "Socket: LGA1851";
    }

    // 14세대, 13세대, 12세대 (Raptor Lake, Alder Lake): LGA1700
    if (/14세대|13세대|12세대|\b(14|13|12)\s*GEN/i.test(combined) ||
      /랩터레이크|RAPTOR|앨더레이크|ALDER/i.test(combined)) {
      return "Socket: LGA1700";
    }

    // 11세대, 10세대 (Rocket Lake, Comet Lake): LGA1200
    if (/11세대|10세대|\b(11|10)\s*GEN/i.test(combined) ||
      /로켓레이크|ROCKET|코멧레이크|COMET/i.test(combined)) {
      return "Socket: LGA1200";
    }

    // 9세대, 8세대 (Coffee Lake): LGA1151
    if (/9세대|8세대|\b(9|8)\s*GEN/i.test(combined) ||
      /커피레이크|COFFEE/i.test(combined)) {
      return "Socket: LGA1151";
    }

    // 7세대, 6세대 (Kaby Lake, Skylake): LGA1151
    if (/7세대|6세대|\b(7|6)\s*GEN/i.test(combined) ||
      /카비레이크|KABY|스카이레이크|SKYLAKE/i.test(combined)) {
      return "Socket: LGA1151";
    }

    // 모델 번호 기반 추론 (예: 14400F, 13400, 12400 → LGA1700)
    const modelMatch = combined.match(/\b(1[0-4]\d{3}[A-Z]*)\b/);
    if (modelMatch) {
      const modelNum = parseInt(modelMatch[1].substring(0, 2));
      if (modelNum >= 12 && modelNum <= 14) return "Socket: LGA1700";
      if (modelNum >= 10 && modelNum <= 11) return "Socket: LGA1200";
      if (modelNum >= 6 && modelNum <= 9) return "Socket: LGA1151";
    }
  }

  return "";
}

/* ==================== CPU 정보 추출 (소켓 포함) ==================== */
function extractCpuInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const parts = [];

  const coreMatch = combined.match(/(\d+)코어|(\d+)\s*CORE/i);
  const threadMatch = combined.match(/(\d+)스레드|(\d+)\s*THREAD/i);

  if (coreMatch) parts.push(`${coreMatch[1] || coreMatch[2]}코어`);
  if (threadMatch) parts.push(`${threadMatch[1] || threadMatch[2]}스레드`);

  const baseClockMatch = combined.match(/베이스[:\s]*(\d+\.?\d*)\s*GHz/i);
  const boostClockMatch = combined.match(/(?:부스트|최대)[:\s]*(\d+\.?\d*)\s*GHz/i);

  if (baseClockMatch) parts.push(`베이스: ${baseClockMatch[1]}GHz`);
  if (boostClockMatch) parts.push(`부스트: ${boostClockMatch[1]}GHz`);

  const cacheMatch = combined.match(/(\d+)\s*MB\s*(?:캐시|CACHE)/i);
  if (cacheMatch) parts.push(`캐시: ${cacheMatch[1]}MB`);

  const tdpMatch = combined.match(/TDP[:\s]*(\d+)W/i);
  if (tdpMatch) parts.push(`TDP: ${tdpMatch[1]}W`);

  // 소켓 정보 추가
  const socket = extractSocket(name, spec);
  if (socket) parts.push(socket);

  return parts.join(", ");
}


/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name) {
  const n = name.toUpperCase();
  if (n.includes("AMD") || n.includes("라이젠") || n.includes("RYZEN")) return "AMD";
  if (n.includes("INTEL") || n.includes("인텔") || n.includes("CORE I")) return "Intel";
  return "";
}

/* ==================== cpubenchmark 크롤링 (수정) ==================== */
async function crawlCpuBenchmark(maxPages = 5) {
  console.log(`🔍 cpubenchmark.net 크롤링 시작 (${maxPages}페이지)`);

  let browser;
  const benchmarks = new Map();

  try {
    browser = await launchBrowser();

    // 브라우저 초기화 대기 시간 단축
    await sleep(1000);

    // ✅ page1 ~ page5 크롤링 (각 페이지마다 새 페이지 객체 생성)
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      let page = null;
      try {
        // 각 페이지마다 새 페이지 객체 생성 (세션 문제 방지)
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(NAV_TIMEOUT);
        page.setDefaultTimeout(NAV_TIMEOUT);

        // 리소스 차단 설정 (속도 향상)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const resourceType = req.resourceType();
          const url = req.url();

          // 이미지, CSS, 폰트, 미디어 차단
          if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            return req.abort();
          }

          // 광고/분석 도메인 차단
          const blockHosts = [
            'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
            'adnxs.com', 'googlesyndication.com', 'scorecardresearch.com',
            'facebook.net', 'analytics.google.com'
          ];
          if (blockHosts.some(host => url.includes(host))) {
            return req.abort();
          }

          return req.continue();
        });

        // 브라우저가 완전히 준비될 때까지 대기
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // 페이지가 준비될 때까지 대기
        await page.evaluateOnNewDocument(() => {
          // 웹드라이버 탐지 방지
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // cpubenchmark.net URL: 모든 페이지를 multithread로 시도 (페이지 1도 포함)
        // 페이지 1은 리스트 페이지와 multithread 둘 다 시도
        let url;
        if (pageNum === 1) {
          // 페이지 1은 먼저 multithread로 시도
          url = 'https://www.cpubenchmark.net/multithread';
        } else {
          url = `https://www.cpubenchmark.net/multithread/page${pageNum}`;
        }

        // 페이지 이동 시도
        try {
          await navigateWithFallback(page, url);

          // 최소한의 대기만 수행 (요소가 나타날 때까지 최대 10초 대기)
          try {
            await Promise.race([
              page.waitForSelector('table#cputable, table.chart, table, ul li a[href*="cpu.php"]', { timeout: 10000 }).catch(() => null),
              sleep(2000) // 최소 2초 대기
            ]);
          } catch (waitError) {
            console.log('⚠️ 요소 로딩 대기 실패, 계속 진행...');
          }
        } catch (gotoError) {
          console.error(`❌ 페이지 ${pageNum} 이동 실패:`, gotoError.message);

          // 페이지 닫기
          if (page) {
            try {
              await page.close();
            } catch (e) {
              // 무시
            }
          }
          continue; // 다음 페이지로
        }

        // ✅ 여러 셀렉터로 데이터 추출 시도
        const items = await page.evaluate(() => {
          const rows = [];

          // 방법 1: 표 형태로 되어있을 경우 (cpu_list.php 페이지)
          const tables = document.querySelectorAll('table#cputable, table.chart, table.chartlist, table');
          for (const table of tables) {
            const tableRows = table.querySelectorAll('tr');
            tableRows.forEach(tr => {
              try {
                // CPU 이름 링크 찾기
                const link = tr.querySelector('a[href*="cpu.php"], a[href*="/cpu/"]');
                if (!link) return;

                const name = link.textContent?.trim() || link.innerText?.trim() || '';
                if (!name) return;

                // 점수는 같은 행의 다른 셀에서 찾기
                const cells = tr.querySelectorAll('td');
                let score = 0;

                // 점수 셀 찾기 (숫자가 가장 큰 셀, 1000 이상)
                cells.forEach(cell => {
                  const text = cell.textContent?.trim().replace(/,/g, '') || '';
                  const num = parseInt(text, 10);
                  if (!isNaN(num) && num > score && num > 1000) {
                    score = num;
                  }
                });

                if (name && score > 0) {
                  rows.push({ name, score });
                }
              } catch (e) {
                // 개별 항목 파싱 실패는 무시
              }
            });
          }

          // 방법 2: ul li a[href*="cpu.php"] (기존 방식)
          if (rows.length === 0) {
            const links = document.querySelectorAll('ul li a[href*="cpu.php"], div a[href*="cpu.php"]');
            links.forEach((link) => {
              try {
                // ✅ <span class="prdname"> 에서 CPU 이름 추출
                const nameEl = link.querySelector('.prdname') || link;
                const name = nameEl?.textContent?.trim() || nameEl?.innerText?.trim() || '';

                // ✅ <span class="count"> 에서 점수 추출
                let scoreEl = link.querySelector('.count');

                // count가 없으면 부모 요소에서 찾기
                if (!scoreEl) {
                  const parent = link.closest('li, tr, div');
                  if (parent) {
                    scoreEl = parent.querySelector('.count, [class*="score"], [class*="mark"]');
                  }
                }

                let score = 0;
                if (scoreEl) {
                  const scoreText = scoreEl.textContent?.trim().replace(/,/g, '') || '';
                  score = parseInt(scoreText, 10);
                }

                if (name && !isNaN(score) && score > 0) {
                  rows.push({ name, score });
                }
              } catch (e) {
                // 개별 항목 파싱 실패는 무시
              }
            });
          }

          return rows;
        });

        items.forEach(item => {
          // 중복 방지: 더 높은 점수로 덮어쓰기
          const existing = benchmarks.get(item.name);
          if (!existing || existing < item.score) {
            benchmarks.set(item.name, item.score);
          }
        });

        console.log(`✅ 페이지 ${pageNum}: ${items.length}개 수집 완료`);
        if (items.length === 0) {
          console.log(`⚠️ 페이지 ${pageNum}에서 데이터를 찾지 못했습니다. 페이지 구조를 확인해주세요.`);
        }

        // 페이지 닫기 (메모리 절약)
        if (page) {
          try {
            await page.close();
          } catch (e) {
            // 무시
          }
        }

        await sleep(1000); // 서버 부하 방지 (대기 시간 단축)

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 크롤링 실패:`, e.message);

        // 페이지 닫기
        if (page) {
          try {
            await page.close();
          } catch (e2) {
            // 무시
          }
        }
      }
    }

  } catch (error) {
    console.error("❌ 브라우저 실행 실패:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`🎉 총 ${benchmarks.size}개 벤치마크 점수 수집 완료`);
  if (benchmarks.size === 0) {
    console.log(`⚠️ 벤치마크 데이터를 수집하지 못했습니다. 사이트 구조 변경 가능성이 있습니다.`);
  } else {
    // 샘플 데이터 출력 (디버깅용)
    const sample = Array.from(benchmarks.entries()).slice(0, 3);
    console.log(`📋 샘플 데이터:`, sample.map(([name, score]) => `${name}: ${score}`).join(', '));
  }
  return benchmarks;
}
/* ==================== 다나와 CPU 크롤링 ==================== */
async function crawlDanawaCpus(maxPages = 10) {
  console.log(`🔍 다나와 CPU 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();

    const page = await browser.newPage();

    // 로케일/타임존 및 탐지 우회
    await page.setDefaultTimeout(NAV_TIMEOUT);
    await page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await page.emulateTimezone('Asia/Seoul');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // 요청 차단 (광고/분석/폰트/미디어)
    const blockHosts = [
      'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'google.com/ccm',
      'ad.danawa.com', 'dsas.danawa.com', 'service-api.flarelane.com', 'doubleclick.net',
      'adnxs.com', 'googlesyndication.com', 'scorecardresearch.com', 'facebook.net'
    ];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const resourceType = req.resourceType();
      if (blockHosts.some(h => url.includes(h))) return req.abort();
      if (resourceType === 'media' || resourceType === 'font') return req.abort();
      return req.continue();
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        if (pageNum === 1) {
          // 첫 페이지 로딩 (재시도 포함)
          let retries = 3;
          let loaded = false;

          while (retries > 0 && !loaded) {
            try {
              await page.goto(DANAWA_CPU_URL, {
                waitUntil: 'domcontentloaded',
                timeout: NAV_TIMEOUT,
              });
              loaded = true;
              console.log('✅ 페이지 로딩 완료');
            } catch (e) {
              retries--;
              console.log(`⚠️ 로딩 재시도 (남은 횟수: ${retries})`);
              if (retries === 0) throw e;
              await sleep(2000);
            }
          }

          // 제품 리스트 로딩 대기
          await page.waitForSelector('.main_prodlist .prod_item', {
            timeout: NAV_TIMEOUT / 3,
          }).catch(() => {
            console.log('⚠️ 제품 리스트 로딩 지연');
          });

          await sleep(3000);

        } else {
          // 다나와 AJAX 기반 페이지네이션 처리
          try {
            console.log(`🔄 페이지 ${pageNum}로 이동 시도...`);

            // 방법 1: 페이지 번호 버튼 클릭 (다나와 기본 방식)
            try {
              const pageSelector = `a.num[page="${pageNum}"]`;
              console.log(`🔍 페이지 버튼 찾기: ${pageSelector}`);

              // 페이지 버튼이 존재하는지 확인
              const pageExists = await page.evaluate((selector) => {
                return document.querySelector(selector) !== null;
              }, pageSelector);

              if (pageExists) {
                console.log(`✅ 페이지 ${pageNum} 버튼 발견`);

                // 페이지 버튼 클릭
                await page.click(pageSelector);
                console.log(`✅ 페이지 ${pageNum} 버튼 클릭 완료`);

                // AJAX 로딩 대기
                await page.waitForTimeout(5000);

                // 페이지 로딩 완료 확인
                await page.waitForFunction(() => {
                  const items = document.querySelectorAll('.main_prodlist .prod_item');
                  return items.length > 0;
                }, { timeout: NAV_TIMEOUT / 3 });

                console.log(`✅ 페이지 ${pageNum} AJAX 로딩 완료`);

              } else {
                throw new Error(`페이지 ${pageNum} 버튼을 찾을 수 없음`);
              }

            } catch (clickError) {
              console.log(`⚠️ 페이지 버튼 클릭 실패: ${clickError.message}`);

              // 방법 2: movePage 함수 직접 호출
              try {
                console.log(`🔄 movePage 함수 호출 시도...`);

                await page.evaluate((p) => {
                  if (typeof movePage === "function") {
                    console.log(`movePage 함수 발견, 페이지 ${p} 호출`);
                    movePage(p);
                  } else if (typeof goPage === "function") {
                    console.log(`goPage 함수 발견, 페이지 ${p} 호출`);
                    goPage(p);
                  } else if (typeof changePage === "function") {
                    console.log(`changePage 함수 발견, 페이지 ${p} 호출`);
                    changePage(p);
                  } else {
                    throw new Error('페이지 이동 함수를 찾을 수 없음');
                  }
                }, pageNum);

                console.log(`✅ movePage 함수 호출 완료`);

                // AJAX 로딩 대기
                await page.waitForTimeout(5000);

                // 페이지 로딩 완료 확인
                await page.waitForFunction(() => {
                  const items = document.querySelectorAll('.main_prodlist .prod_item');
                  return items.length > 0;
                }, { timeout: NAV_TIMEOUT / 3 });

                console.log(`✅ 페이지 ${pageNum} 함수 호출 로딩 완료`);

              } catch (functionError) {
                console.log(`⚠️ movePage 함수 호출 실패: ${functionError.message}`);
                throw new Error(`모든 페이지 이동 방법 실패`);
              }
            }

          } catch (navError) {
            console.log(`❌ 페이지 ${pageNum} 이동 완전 실패: ${navError.message}`);
            console.log(`⚠️ 페이지 ${pageNum} 건너뛰고 계속 진행`);
            continue;
          }
        }

        // 제품 리스트 추출 (가격 정보 포함)
        const pageProducts = await page.evaluate(() => {
          const items = document.querySelectorAll('.main_prodlist .product_list .prod_item');
          const results = [];

          items.forEach((item) => {
            try {
              const nameEl = item.querySelector('.prod_name a');
              const name = nameEl?.textContent?.trim();

              if (!name) return;

              // 이미지 추출 개선: 여러 선택자와 속성 확인
              let image = '';

              // 방법 1: thumb_link 내부 이미지
              const thumbLink = item.querySelector('.thumb_link') || item.querySelector('a.thumb_link');
              let imgEl = null;

              if (thumbLink) {
                imgEl = thumbLink.querySelector('img') || thumbLink.querySelector('picture img');
              }

              // 방법 2: 직접 이미지 요소 찾기
              if (!imgEl) {
                imgEl = item.querySelector('img') ||
                  item.querySelector('.thumb_image img') ||
                  item.querySelector('.prod_img img') ||
                  item.querySelector('picture img') ||
                  item.querySelector('.img_wrap img');
              }

              if (imgEl) {
                // 다양한 lazy loading 속성 확인 (우선순위 순)
                const attrs = [
                  'src', 'data-original', 'data-src', 'data-lazy-src',
                  'data-origin', 'data-url', 'data-img', 'data-image',
                  'data-lazy', 'data-srcset', 'data-original-src'
                ];

                for (const attr of attrs) {
                  const val = imgEl.getAttribute(attr) || imgEl[attr];
                  if (val && typeof val === 'string' && val.trim() && !val.includes('noImg') && !val.includes('noData')) {
                    image = val.trim();
                    break;
                  }
                }

                // srcset에서 추출
                if (!image && imgEl.srcset) {
                  const srcsetMatch = imgEl.srcset.match(/https?:\/\/[^\s,]+/);
                  if (srcsetMatch) {
                    image = srcsetMatch[0];
                  }
                }

                // 상대 경로를 절대 경로로 변환
                if (image) {
                  if (image.startsWith('//')) {
                    image = 'https:' + image;
                  } else if (image.startsWith('/')) {
                    image = 'https://img.danawa.com' + image;
                  }
                  // noImg 플레이스홀더는 빈 문자열로 처리
                  if (image.includes('noImg') || image.includes('noData') || image.includes('placeholder')) {
                    image = '';
                  }
                }
              }

              // 방법 3: 배경 이미지에서 추출
              if (!image) {
                const bgEl = thumbLink || item.querySelector('.thumb_image') || item.querySelector('.prod_img');
                if (bgEl) {
                  const style = window.getComputedStyle(bgEl);
                  const bgImage = style.backgroundImage || bgEl.style.backgroundImage;
                  if (bgImage && bgImage !== 'none') {
                    const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                    if (urlMatch && urlMatch[1]) {
                      image = urlMatch[1];
                      if (image.startsWith('//')) {
                        image = 'https:' + image;
                      } else if (image.startsWith('/')) {
                        image = 'https://img.danawa.com' + image;
                      }
                    }
                  }
                }
              }

              // 방법 4: 제품 링크에서 제품 ID 추출
              if (!image && nameEl) {
                const prodHref = nameEl.getAttribute('href') || '';
                const codeMatch = prodHref.match(/code=(\d+)/);
                if (codeMatch) {
                  const prodCode = codeMatch[1];
                  const codeParts = prodCode.match(/(\d{2})(\d{2})(\d{2})/);
                  if (codeParts) {
                    const [_, a, b, c] = codeParts;
                    image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`;
                  }
                }
              }

              if (!image && thumbLink) {
                const href = thumbLink.getAttribute('href') || '';
                const codeMatch = href.match(/code=(\d+)/);
                if (codeMatch) {
                  const prodCode = codeMatch[1];
                  const codeParts = prodCode.match(/(\d{2})(\d{2})(\d{2})/);
                  if (codeParts) {
                    const [_, a, b, c] = codeParts;
                    image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`;
                  }
                }
              }

              // 상세 스펙 정보 추출 (여러 소스에서 수집)
              let detailedSpec = '';

              // 1. spec_list에서 기본 스펙
              const specEl = item.querySelector('.spec_list');
              const basicSpec = specEl?.textContent
                ?.trim()
                .replace(/\s+/g, ' ')
                .replace(/더보기/g, '') || '';

              // 2. prod_spec_set에서 상세 스펙 (다나와 상세 정보)
              const specSetEl = item.querySelector('.prod_spec_set');
              const specSetText = specSetEl?.textContent
                ?.trim()
                .replace(/\s+/g, ' ')
                .replace(/더보기/g, '') || '';

              // 3. prod_info에서 추가 정보
              const infoEl = item.querySelector('.prod_info');
              const infoText = infoEl?.textContent
                ?.trim()
                .replace(/\s+/g, ' ') || '';

              // 4. spec_list 내부의 모든 텍스트 노드 수집
              let allSpecText = '';
              if (specEl) {
                // spec_list 내부의 모든 텍스트 수집
                const specItems = specEl.querySelectorAll('li, dd, dt, span, div');
                const specParts = [];
                specItems.forEach(el => {
                  const text = el.textContent?.trim();
                  if (text && text.length > 0 && !text.match(/^(더보기|접기)$/)) {
                    specParts.push(text);
                  }
                });
                if (specParts.length > 0) {
                  allSpecText = specParts.join('/');
                }
              }

              // 5. 상세 정보 조합 (우선순위: allSpecText > specSetText > basicSpec > infoText)
              if (allSpecText) {
                detailedSpec = allSpecText;
              } else if (specSetText) {
                detailedSpec = specSetText;
              } else if (basicSpec) {
                detailedSpec = basicSpec;
              } else if (infoText) {
                detailedSpec = infoText;
              }

              // 상세 페이지 링크 추출 (나중에 상세 페이지 크롤링용)
              const detailLink = nameEl?.getAttribute('href') || '';
              const prodCode = detailLink.match(/code=(\d+)/)?.[1] || '';

              // 가격 정보 추출
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) {
                const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
                price = parseInt(priceText, 10) || 0;
              }

              results.push({
                name,
                image,
                spec: detailedSpec || basicSpec || '',
                price,
                prodCode,
                detailLink: detailLink ? (detailLink.startsWith('http') ? detailLink : `https://prod.danawa.com${detailLink}`) : ''
              });
            } catch (e) {
              // 개별 아이템 파싱 실패는 무시
            }
          });

          return results;
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개 수집`);

        if (pageProducts.length === 0) {
          console.log('⚠️ 페이지에서 제품을 찾지 못함 - 크롤링 중단');
          break;
        }

        products.push(...pageProducts);

        // 다음 페이지 확인
        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector('.nav_next');
          return nextBtn && !nextBtn.classList.contains('disabled');
        });

        if (!hasNext && pageNum < maxPages) {
          console.log(`⏹️ 마지막 페이지 도달 (페이지 ${pageNum})`);
          break;
        }

        await sleep(2000);

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);

        // 첫 페이지 실패 시 중단
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
  if (benchmarks.has(cpuName)) {
    return benchmarks.get(cpuName);
  }

  const normalizedCpuName = normalizeCpuName(cpuName);

  // ⚠️ matchCpuNames는 접미사 검증이 없으므로 제거
  // 대신 아래의 모델 번호 기반 매칭을 사용

  // 브랜드 확인
  const cpuBrand = extractBrand(cpuName);

  // 모델 번호 추출 (예: 9500F, 14600K, 7800X3D, 13400, G6900, E3-1220V5, X5680)
  const extractModelNumber = (name) => {
    const n = name.toUpperCase();

    // 1. 제온 E3/E5 형식: E3-1220V5, E3-1220 v5, E5-2696V3 등
    const xeonE = n.match(/\b(E[3-9]|E5)-\s*(\d{4,})\s*([Vv]\d+)?\b/i);
    if (xeonE) {
      const version = xeonE[3] ? xeonE[3].toUpperCase() : '';
      return `${xeonE[1]}-${xeonE[2]}${version}`.replace(/\s+/g, '').toUpperCase();
    }

    // 2. 제온 X 형식: X5680, X5690 등
    const xeonX = n.match(/\b(X\d{4,})\b/i);
    if (xeonX) {
      return xeonX[1].toUpperCase();
    }

    // 3. 셀러론/펜티엄 G 형식: G6900, G5400, G6400 등
    const gSeries = n.match(/\b(G\d{4,})\b/i);
    if (gSeries) {
      return gSeries[1].toUpperCase();
    }

    // 4. Core2 형식: Q9550, E7500, E5200 등
    const core2 = n.match(/\b([QE]\d{4,})\b/i);
    if (core2) {
      return core2[1].toUpperCase();
    }

    // 5. 일반 형식: 숫자로 시작 (예: 9500F, 14600K, 7800X3D, 13400)
    const patterns = [
      /\b(\d{4,}[A-Z0-9X3D]*)\b/i,  // 4자리 이상 숫자 (예: 9500F, 14600KF, 13400)
      /\b(\d{3}[A-Z0-9X3D]*)\b/i,   // 3자리 숫자 (예: 265KF)
    ];

    for (const pattern of patterns) {
      const matches = n.match(pattern);
      if (matches && matches.length > 0) {
        // 가장 긴 모델 번호를 선택 (예: 14600KF가 14600보다 우선)
        return matches.reduce((longest, current) =>
          current.length > longest.length ? current : longest
        ).toUpperCase();
      }
    }

    return null;
  };

  // 접미사 추출 헬퍼 함수
  const extractSuffix = (modelNumber) => {
    if (!modelNumber) return '';
    return modelNumber.replace(/\d+/g, '').toUpperCase();
  };

  // CPU 시리즈 추출 (Ryzen, Phenom, Core i5 등)
  const extractSeries = (name) => {
    const n = name.toUpperCase();

    // AMD 시리즈
    if (n.includes('RYZEN') || n.includes('라이젠')) return 'RYZEN';
    if (n.includes('PHENOM')) return 'PHENOM';
    if (n.includes('ATHLON')) return 'ATHLON';
    if (n.includes('THREADRIPPER')) return 'THREADRIPPER';
    if (n.includes('EPYC')) return 'EPYC';

    // Intel 시리즈
    if (n.includes('CORE I3') || n.includes('코어I3') || n.includes('코어 I3')) return 'CORE_I3';
    if (n.includes('CORE I5') || n.includes('코어I5') || n.includes('코어 I5')) return 'CORE_I5';
    if (n.includes('CORE I7') || n.includes('코어I7') || n.includes('코어 I7')) return 'CORE_I7';
    if (n.includes('CORE I9') || n.includes('코어I9') || n.includes('코어 I9')) return 'CORE_I9';
    if (n.includes('CORE ULTRA') || n.includes('ULTR')) return 'CORE_ULTRA';
    if (n.includes('CELERON') || n.includes('셀러론')) return 'CELERON';
    if (n.includes('PENTIUM') || n.includes('펜티엄')) return 'PENTIUM';
    if (n.includes('XEON') || n.includes('제온')) return 'XEON';
    if (n.includes('CORE2') || n.includes('코어2')) return 'CORE2';

    return null;
  };

  const cpuModel = extractModelNumber(cpuName);
  const cpuSeries = extractSeries(cpuName);

  // 정확한 모델 번호 매칭 시도 (우선순위 1)
  if (cpuModel) {
    for (const [benchName, score] of benchmarks.entries()) {
      // 브랜드 검증 (엄격하게)
      const benchBrand = extractBrand(benchName);

      // CPU 브랜드가 없으면 스킵 (매칭 불가)
      if (!cpuBrand) {
        continue;
      }

      // 벤치마크 브랜드가 없거나 다르면 스킵
      if (!benchBrand || cpuBrand !== benchBrand) {
        continue;
      }

      // 다른 브랜드(ARM, Samsung 등)는 무조건 스킵
      if (benchBrand === "OTHER") {
        continue;
      }

      const benchModel = extractModelNumber(benchName);
      if (!benchModel) continue;

      const benchModelUpper = benchModel.toUpperCase();
      const benchSeries = extractSeries(benchName);

      // 시리즈가 다르면 매칭 안 함 (예: Ryzen 9500F ≠ Phenom 9500)
      if (cpuSeries && benchSeries && cpuSeries !== benchSeries) {
        continue;
      }

      // 1. 모델 번호가 정확히 일치하는 경우 (예: 9500F ↔ 9500F)
      if (cpuModel && cpuModel === benchModelUpper) {
        console.log(`✅ 정확한 모델 매칭: "${cpuName}" ↔ "${benchName}" (${score}점)`);
        return score;
      }

      // 2. 숫자 부분만 일치하는 경우 - 접미사가 정확히 일치해야만 매칭
      // 단, E3-1220V5 같은 형식은 정확히 일치해야 함
      if (cpuModel.includes('-') || benchModelUpper.includes('-')) {
        // 하이픈이 있는 경우 (제온 E3/E5 등)는 정확히 일치해야만 매칭
        continue;
      }

      const cpuModelNum = cpuModel ? cpuModel.replace(/[A-Z-]/g, '') : '';
      const benchModelNum = benchModelUpper.replace(/[A-Z-]/g, '');

      // 숫자 부분이 정확히 일치하고 4자리 이상인 경우
      if (cpuModelNum && cpuModelNum === benchModelNum && cpuModelNum.length >= 4) {
        // 접미사 추출 (F, K, X, X3D, E 등)
        const cpuSuffix = extractSuffix(cpuModel);
        const benchSuffix = extractSuffix(benchModelUpper);

        // ⚠️ 핵심: 접미사가 정확히 일치해야만 매칭 허용
        // - 둘 다 접미사 없음: OK (예: 13400 ↔ 13400)
        // - 접미사가 정확히 일치: OK (예: 9500F ↔ 9500F)
        // - 접미사가 다름: NO (예: 13400 ≠ 13400E, 9900 ≠ 9900X, 9500F ≠ 9500)
        if (cpuSuffix === benchSuffix) {
          console.log(`⚠️ 모델 번호 매칭: "${cpuName}" ↔ "${benchName}" (${score}점)`);
          return score;
        }
      }
    }
  }

  // 토큰 기반 부분 매칭 (우선순위 2 - 더 엄격하게)
  // ⚠️ 주의: 모델 번호와 접미사가 정확히 일치해야만 사용
  const tokens = normalizedCpuName.split(/\s+/).filter(t => /\d/.test(t) && t.length > 1);

  for (const [benchName, score] of benchmarks.entries()) {
    // 브랜드 검증 (엄격하게)
    const benchBrand = extractBrand(benchName);

    // CPU 브랜드가 없으면 스킵
    if (!cpuBrand) {
      continue;
    }

    // 벤치마크 브랜드가 없거나 다르면 스킵
    if (!benchBrand || cpuBrand !== benchBrand) {
      continue;
    }

    // 다른 브랜드(ARM, Samsung 등)는 무조건 스킵
    if (benchBrand === "OTHER") {
      continue;
    }

    // 시리즈가 다르면 스킵
    const benchSeries = extractSeries(benchName);
    if (cpuSeries && benchSeries && cpuSeries !== benchSeries) {
      continue;
    }

    // 모델 번호와 접미사 확인
    const benchModel = extractModelNumber(benchName);
    if (cpuModel && benchModel) {
      const benchModelUpper = benchModel.toUpperCase();

      // 모델 번호가 정확히 일치하는 경우만 허용
      if (cpuModel !== benchModelUpper) {
        // 하이픈이 있는 경우 (제온 E3/E5 등)는 정확히 일치해야만 매칭
        if (cpuModel.includes('-') || benchModelUpper.includes('-')) {
          continue;
        }

        // 숫자 부분만 일치하는 경우, 접미사도 정확히 일치해야 함
        const cpuModelNum = cpuModel.replace(/[A-Z-]/g, '');
        const benchModelNum = benchModelUpper.replace(/[A-Z-]/g, '');

        if (cpuModelNum === benchModelNum && cpuModelNum.length >= 4) {
          const cpuSuffix = extractSuffix(cpuModel);
          const benchSuffix = extractSuffix(benchModelUpper);

          // 접미사가 다르면 매칭 안 함 (예: 3700X ≠ 3700, 12700F ≠ 12700K)
          if (cpuSuffix !== benchSuffix) {
            continue;
          }
        } else {
          // 숫자 부분도 일치하지 않으면 스킵
          continue;
        }
      }
    }

    const normalizedBench = normalizeCpuName(benchName);
    const allTokensMatch = tokens.every(t => normalizedBench.includes(t));

    // 최소 3개 이상의 토큰이 일치해야 함 (너무 느슨한 매칭 방지)
    if (allTokensMatch && tokens.length >= 3) {
      console.log(`⚠️ 부분 매칭: "${cpuName}" ↔ "${benchName}" (${score}점)`);
      return score;
    }
  }

  console.log(`❌ 매칭 실패: "${cpuName}"`);
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
  let skipped = 0;

  for (const cpu of cpus) {
    // 가격이 0원인 품목은 저장하지 않음
    if (!cpu.price || cpu.price === 0) {
      skipped++;
      console.log(`⏭️  건너뜀 (가격 0원): ${cpu.name}`);
      continue;
    }

    const old = byName.get(cpu.name);
    const baseInfo = extractCpuInfo(cpu.name, cpu.spec);

    // 크롤링한 상세 스펙 정보 우선 사용 (다나와에서 가져온 상세 정보)
    const crawledSpec = cpu.spec?.trim() || '';
    const hasDetailedSpec = crawledSpec.length > baseInfo.length && crawledSpec.length > 20;

    const benchScore = findBenchmarkScore(cpu.name, benchmarks);
    if (benchScore > 0) withScore++;

    // 임계값 미만이면 저장/업데이트 건너뜀
    if (!benchScore || benchScore < MIN_PASSMARK_SCORE_FOR_SAVE) {
      console.log(`⛔ 저장 제외 (PassMark ${benchScore} < ${MIN_PASSMARK_SCORE_FOR_SAVE}):`, cpu.name);
      continue;
    }

    let review = old?.review?.trim() ? old.review : "";
    // info 우선순위: 크롤링한 상세 스펙 > 기존 info > baseInfo
    let info = hasDetailedSpec
      ? crawledSpec
      : (old?.info?.trim() || baseInfo);

    if (ai) {
      const needsReview = !old?.review || old.review.trim() === "";
      const oldInfoTrimmed = old?.info?.trim() || "";
      // 크롤링한 상세 정보가 있고 기존 info와 다르면 업데이트 필요
      const needsInfo =
        force ||
        oldInfoTrimmed === "" ||
        (hasDetailedSpec && oldInfoTrimmed !== crawledSpec) ||
        (!hasDetailedSpec && oldInfoTrimmed === baseInfo.trim());

      if (needsReview || needsInfo) {
        console.log(`🤖 AI 한줄평/상세 스펙 생성 중: ${cpu.name.slice(0, 40)}...`);
        const aiRes = await fetchAiOneLiner({
          name: cpu.name,
          spec: hasDetailedSpec ? crawledSpec : cpu.spec,
        });
        if (aiRes.review) {
          review = aiRes.review;
          console.log(`   ✅ AI 한줄평: "${aiRes.review.slice(0, 50)}..."`);
        }
        // AI가 생성한 info가 있고, 크롤링한 정보보다 더 상세하면 사용
        if (aiRes.info && aiRes.info.trim().length > info.length) {
          info = aiRes.info;
        } else if (hasDetailedSpec) {
          // 크롤링한 상세 정보가 있으면 그것을 우선 사용
          info = crawledSpec;
        }
      }
    } else {
      review = old?.review || review;
      // AI를 사용하지 않아도 크롤링한 상세 정보는 사용
      if (hasDetailedSpec) {
        info = crawledSpec;
      } else {
        info = old?.info || info;
      }
    }

    if (!info || info.trim() === "") {
      info = baseInfo;
    }

    if (!review || review.trim() === "") {
      const upperName = cpu.name.toUpperCase();
      let tag = "일반 작업과 가벼운 게이밍에 적합";
      if (/THREADRIPPER|EPYC/.test(upperName)) tag = "워크스테이션/서버급 연산에 적합";
      else if (/XEON/.test(upperName)) tag = "서버/워크스테이션 용도에 적합";
      else if (/X3D/.test(upperName)) tag = "게이밍 성능 최적화 (대용량 캐시)";
      else if (/K\b/.test(upperName)) tag = "오버클럭/게이밍에 유리";
      else if (/F\b/.test(upperName)) tag = "내장그래픽 없음, 외장 GPU 권장";

      if (benchScore && benchScore > 0) {
        if (benchScore >= 45000) tag += ", 하이엔드 성능";
        else if (benchScore >= 25000) tag += ", 상급 성능";
        else if (benchScore >= 12000) tag += ", 중급 성능";
        else tag += ", 보급형 성능";
      }
      review = tag;
    }

    const update = {
      category: "cpu",
      info,
      image: cpu.image,
      manufacturer: extractManufacturer(cpu.name),
      price: cpu.price || 0, // 가격 정보 추가
    };

    // 기존 벤치마크 점수가 있으면 갱신하지 않음
    const hasExistingBench = old?.benchScore && old.benchScore > 0;
    if (!hasExistingBench) {
      update.benchScore = benchScore;
    }

    if (review) update.review = review;

    if (old) {
      // 가격 히스토리 업데이트 (새로운 가격이 있고 기존과 다를 때)
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update, $unset: { specSummary: "" } };

      if (cpu.price > 0 && cpu.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        const alreadyExists = priceHistory.some(p => p.date === today);

        if (!alreadyExists) {
          ops.$push = { priceHistory: { date: today, price: cpu.price } };
        }
      }

      await col.updateOne({ _id: old._id }, ops);
      updated++;
      const scoreLog = hasExistingBench ? `점수 유지: ${old.benchScore}` : `점수: ${benchScore}`;
      console.log(`🔁 업데이트: ${cpu.name} (${scoreLog}, 가격: ${cpu.price.toLocaleString()}원)`);
    } else {
      // 신규 추가 시 가격 히스토리 초기화
      const priceHistory = [];
      if (cpu.price > 0) {
        const today = new Date().toISOString().slice(0, 10);
        priceHistory.push({ date: today, price: cpu.price });
      }

      await col.insertOne({
        name: cpu.name,
        ...update,
        priceHistory,
      });
      inserted++;
      console.log(`🆕 신규 추가: ${cpu.name} (점수: ${benchScore}, 가격: ${cpu.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  // 모든 CPU 문서에서 legacy specSummary 필드 제거
  await col.updateMany(
    { category: "cpu", specSummary: { $exists: true } },
    { $unset: { specSummary: "" } }
  );

  const currentNames = new Set(cpus.map((c) => c.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cpu", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개 (가격 0원)`
  );
  console.log(`📊 벤치마크 점수: ${withScore}/${cpus.length}개 매칭 완료`);
  console.log(`💰 가격 정보도 함께 크롤링하여 저장 완료`);
}

/* ==================== Express 라우터 ==================== */
router.post("/sync-cpus", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 15;
    const benchPages = parseInt(req.body?.benchPages) || 10; // 🆕 벤치마크 페이지 수 증가 (5 → 10)
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({
      message: `✅ CPU 동기화 시작 (다나와: ${maxPages}p, 벤치마크: ${benchPages}p, AI: ${ai}, 가격 포함)`,
    });

    setImmediate(async () => {
      try {
        console.log("\n=== CPU 동기화 시작 ===");

        const benchmarks = await crawlCpuBenchmark(benchPages);
        const cpus = await crawlDanawaCpus(maxPages);

        if (cpus.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(cpus, benchmarks, { ai, force });

        console.log("🎉 CPU 동기화 완료 (가격 정보 포함)");
        console.log("💰 가격 정보가 함께 크롤링되어 저장되었습니다");
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
