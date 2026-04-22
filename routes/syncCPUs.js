// routes/syncCPUs.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser, setupPage, navigateToDanawaPage, BLOCK_HOSTS, sleep } from "../utils/browser.js";
import { invalidatePartsCache } from "../utils/recommend-helpers.js";
import { fetchNaverPrice } from "../utils/priceResolver.js";

const router = express.Router();
const MIN_PASSMARK_SCORE_FOR_SAVE = 10000;
const DANAWA_CPU_URL = "https://prod.danawa.com/list/?cate=112747";
const CPUBENCHMARK_BASE_URL = "https://www.cpubenchmark.net/multithread";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NAV_TIMEOUT = Number(process.env.PUPPETEER_NAV_TIMEOUT || 45000);

async function navigateWithFallback(page, url) {
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
      console.log(`⚠️ waitUntil=${option.waitUntil} 로딩 실패, 다음 전략으로 재시도...`);
      await sleep(1000);
    }
  }
  throw lastError || new Error("페이지 이동 실패");
}

function normalizeCpuName(name) {
  let normalized = name.toUpperCase();
  normalized = normalized.replace(/[-\s]*\d+\uc138\ub300[-\s]*/g, " ");
  normalized = normalized.replace(/\([^)]*\)/g, "");
  const replacements = {
    "라이젤": "RYZEN", "스레드리퍼": "THREADRIPPER", "애슬론": "ATHLON",
    "인텔": "INTEL", "코어": "CORE", "웹트라": "ULTRA",
    "폰티엄": "PENTIUM", "셀러론": "CELERON", "제온": "XEON",
  };
  for (const [kor, eng] of Object.entries(replacements)) {
    normalized = normalized.replace(new RegExp(kor, "gi"), eng);
  }
  normalized = normalized.replace(/\uc2dc리즈\d+/gi, "");
  normalized = normalized.replace(/[-_]/g, " ");
  normalized = normalized.replace(/([A-Z])(\d)/g, "$1 $2");
  normalized = normalized.replace(/(\d)([A-Z])/g, "$1 $2");
  normalized = normalized.replace(/\s+/g, " ").trim();
  if (normalized.includes("RYZEN") || normalized.includes("THREADRIPPER") || normalized.includes("ATHLON")) {
    if (!normalized.startsWith("AMD")) normalized = "AMD " + normalized;
  }
  if (normalized.includes("CORE") || normalized.includes("PENTIUM") || normalized.includes("CELERON") || normalized.includes("XEON")) {
    if (!normalized.startsWith("INTEL")) normalized = "INTEL " + normalized;
  }
  return normalized;
}

function extractBrand(name) {
  const n = name.toUpperCase();
  if (n.includes("ARM") || n.includes("SAMSUNG") || n.includes("MEDIATEK") || n.includes("QUALCOMM") || n.includes("APPLE") || n.includes("EXYNOS") || n.includes("DIMENSITY") || n.includes("SNAPDRAGON")) return "OTHER";
  if (n.includes("AMD") || n.includes("RYZEN") || n.includes("라이젤") || n.includes("THREADRIPPER") || n.includes("ATHLON") || n.includes("PHENOM") || n.includes("FX") || n.includes("EPYC")) return "AMD";
  if (n.includes("INTEL") || n.includes("CORE") || n.includes("인텔") || n.includes("코어") || n.includes("PENTIUM") || n.includes("폰티엄") || n.includes("CELERON") || n.includes("셀러론") || n.includes("XEON") || n.includes("제온") || n.includes("ULTR") || n.startsWith("I3 ") || n.startsWith("I5 ") || n.startsWith("I7 ") || n.startsWith("I9 ")) return "Intel";
  return null;
}

function matchCpuNames(danawaName, benchmarkName) {
  const brand1 = extractBrand(danawaName);
  const brand2 = extractBrand(benchmarkName);
  if (brand1 && brand2 && brand1 !== brand2) return false;
  const norm1 = normalizeCpuName(danawaName);
  const norm2 = normalizeCpuName(benchmarkName);
  if (norm1 === norm2) return true;
  const extractTokens = (str) => str.split(/\s+/).filter(t => t.length > 0);
  const tokens1 = extractTokens(norm1);
  const tokens2 = extractTokens(norm2);
  const coreTokens1 = tokens1.filter(t => /\d/.test(t));
  const coreTokens2 = tokens2.filter(t => /\d/.test(t));
  if (coreTokens1.length === 0 || coreTokens2.length === 0) return false;
  return coreTokens1.every(t => norm2.includes(t)) && coreTokens2.every(t => norm1.includes(t));
}

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) return { review: "", info: "" };
  const prompt = `CPU "${name}"(스펙: ${spec})의 한줄평과 상세 스펙 설명을 JSON으로 작성: {"review":"<100자 이내>", "info":"<코어/스레드/클럭/캐시/TDP/소켓/지원 기능 등을 한 문단으로 요약>"}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4",
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
      return { review: parsed.review?.trim() || "", info: parsed.info?.trim() || "" };
    } catch (e) {
      await sleep(800 * Math.pow(2, i));
    }
  }
  return { review: "", info: "" };
}

function extractSocket(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  if (/AM5/i.test(combined)) return "Socket: AM5";
  if (/AM4/i.test(combined)) return "Socket: AM4";
  if (/sTRX4/i.test(combined)) return "Socket: sTRX4";
  if (/TR4/i.test(combined)) return "Socket: TR4";
  if (/SP3/i.test(combined)) return "Socket: SP3";
  if (/LGA\s?1700/i.test(combined)) return "Socket: LGA1700";
  if (/LGA\s?1851/i.test(combined)) return "Socket: LGA1851";
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
  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `Socket: LGA${lga[1]}`;
  if (/\uc778\ud154|INTEL/i.test(combined)) {
    if (/\ucf54어\s*\uc6f9트라|CORE\s*ULTRA/i.test(combined) && /\uc2dc리즈\s*2|SERIES\s*2|애로우레이크|ARROW\s*LAKE/i.test(combined)) return "Socket: LGA1851";
    if (/14\uc138대|13\uc138대|12\uc138대|\b(14|13|12)\s*GEN/i.test(combined) || /낙터레이크|RAPTOR|앨더레이크|ALDER/i.test(combined)) return "Socket: LGA1700";
    if (/11\uc138대|10\uc138대|\b(11|10)\s*GEN/i.test(combined) || /로켓레이크|ROCKET|코멧레이크|COMET/i.test(combined)) return "Socket: LGA1200";
    if (/9\uc138대|8\uc138대|\b(9|8)\s*GEN/i.test(combined) || /커피레이크|COFFEE/i.test(combined)) return "Socket: LGA1151";
    if (/7\uc138대|6\uc138대|\b(7|6)\s*GEN/i.test(combined) || /카비레이크|KABY|\uc2a4카이레이크|SKYLAKE/i.test(combined)) return "Socket: LGA1151";
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

function extractCpuInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const parts = [];
  const coreMatch = combined.match(/(\d+)\ucf54어|(\d+)\s*CORE/i);
  const threadMatch = combined.match(/(\d+)\uc2a4레드|(\d+)\s*THREAD/i);
  if (coreMatch) parts.push(`${coreMatch[1] || coreMatch[2]}\ucf54어`);
  if (threadMatch) parts.push(`${threadMatch[1] || threadMatch[2]}\uc2a4레드`);
  const baseClockMatch = combined.match(/\ubca0이스[:\s]*(\d+\.?\d*)\s*GHz/i);
  const boostClockMatch = combined.match(/(?:\ubd80스트|\ucd5c대)[:\s]*(\d+\.?\d*)\s*GHz/i);
  if (baseClockMatch) parts.push(`\ubca0이스: ${baseClockMatch[1]}GHz`);
  if (boostClockMatch) parts.push(`\ubd80스트: ${boostClockMatch[1]}GHz`);
  const cacheMatch = combined.match(/(\d+)\s*MB\s*(?:\ucf00시|CACHE)/i);
  if (cacheMatch) parts.push(`\ucf00시: ${cacheMatch[1]}MB`);
  const tdpMatch = combined.match(/TDP[:\s]*(\d+)W/i);
  if (tdpMatch) parts.push(`TDP: ${tdpMatch[1]}W`);
  const socket = extractSocket(name, spec);
  if (socket) parts.push(socket);
  return parts.join(", ");
}

function extractManufacturer(name) {
  const n = name.toUpperCase();
  if (n.includes("AMD") || n.includes("라이젤") || n.includes("RYZEN")) return "AMD";
  if (n.includes("INTEL") || n.includes("인텔") || n.includes("CORE I")) return "Intel";
  return "";
}

async function crawlCpuBenchmark(maxPages = 5) {
  console.log(`🔍 cpubenchmark.net 크롤링 시작 (${maxPages}페이지)`);
  let browser;
  const benchmarks = new Map();
  try {
    browser = await launchBrowser();
    await sleep(1000);
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      let page = null;
      try {
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(NAV_TIMEOUT);
        page.setDefaultTimeout(NAV_TIMEOUT);
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const resourceType = req.resourceType();
          const url = req.url();
          if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) return req.abort();
          if (BLOCK_HOSTS.some(host => url.includes(host))) return req.abort();
          return req.continue();
        });
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        const url = pageNum === 1 ? 'https://www.cpubenchmark.net/multithread' : `https://www.cpubenchmark.net/multithread/page${pageNum}`;
        try {
          await navigateWithFallback(page, url);
          await Promise.race([
            page.waitForSelector('table#cputable, table.chart, table, ul li a[href*="cpu.php"]', { timeout: 10000 }).catch(() => null),
            sleep(2000),
          ]);
        } catch (gotoError) {
          console.error(`❌ 페이지 ${pageNum} 이동 실패:`, gotoError.message);
          if (page) { try { await page.close(); } catch (e) {} }
          continue;
        }
        const items = await page.evaluate(() => {
          const rows = [];
          const tables = document.querySelectorAll('table#cputable, table.chart, table.chartlist, table');
          for (const table of tables) {
            table.querySelectorAll('tr').forEach(tr => {
              try {
                const link = tr.querySelector('a[href*="cpu.php"], a[href*="/cpu/"]');
                if (!link) return;
                const name = link.textContent?.trim() || '';
                if (!name) return;
                let score = 0;
                tr.querySelectorAll('td').forEach(cell => {
                  const num = parseInt(cell.textContent?.trim().replace(/,/g, '') || '', 10);
                  if (!isNaN(num) && num > score && num > 1000) score = num;
                });
                if (name && score > 0) rows.push({ name, score });
              } catch (e) {}
            });
          }
          if (rows.length === 0) {
            document.querySelectorAll('ul li a[href*="cpu.php"], div a[href*="cpu.php"]').forEach(link => {
              try {
                const nameEl = link.querySelector('.prdname') || link;
                const name = nameEl?.textContent?.trim() || '';
                let scoreEl = link.querySelector('.count');
                if (!scoreEl) { const parent = link.closest('li, tr, div'); if (parent) scoreEl = parent.querySelector('.count, [class*="score"], [class*="mark"]'); }
                let score = 0;
                if (scoreEl) score = parseInt(scoreEl.textContent?.trim().replace(/,/g, '') || '', 10);
                if (name && !isNaN(score) && score > 0) rows.push({ name, score });
              } catch (e) {}
            });
          }
          return rows;
        });
        items.forEach(item => {
          const existing = benchmarks.get(item.name);
          if (!existing || existing < item.score) benchmarks.set(item.name, item.score);
        });
        console.log(`✅ 페이지 ${pageNum}: ${items.length}개 수집 완료`);
        if (page) { try { await page.close(); } catch (e) {} }
        await sleep(1000);
      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 크롤링 실패:`, e.message);
        if (page) { try { await page.close(); } catch (e2) {} }
      }
    }
  } catch (error) {
    console.error("❌ 브라우저 실행 실패:", error.message);
  } finally {
    if (browser) await browser.close();
  }
  console.log(`🎉 총 ${benchmarks.size}개 벤치마크 점수 수집 완료`);
  return benchmarks;
}

async function crawlDanawaCpus(maxPages = 10) {
  console.log(`🔍 다나와 CPU 크롤링 시작 (최대 ${maxPages}페이지)`);
  let browser;
  const products = [];
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await setupPage(page, NAV_TIMEOUT);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 크롤링 중...`);
      try {
        if (pageNum === 1) {
          let retries = 3;
          let loaded = false;
          while (retries > 0 && !loaded) {
            try {
              await page.goto(DANAWA_CPU_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
              loaded = true;
            } catch (e) {
              retries--;
              if (retries === 0) throw e;
              await sleep(2000);
            }
          }
          await page.waitForSelector('.main_prodlist .prod_item', { timeout: NAV_TIMEOUT / 3 }).catch(() => {});
          await sleep(3000);
        } else {
          await navigateToDanawaPage(page, pageNum, '.main_prodlist .prod_item');
        }

        const pageProducts = await page.evaluate(() => {
          const items = document.querySelectorAll('.main_prodlist .product_list .prod_item');
          const results = [];
          items.forEach((item) => {
            try {
              const nameEl = item.querySelector('.prod_name a');
              const name = nameEl?.textContent?.trim();
              if (!name) return;
              let image = '';
              const thumbLink = item.querySelector('.thumb_link') || item.querySelector('a.thumb_link');
              let imgEl = thumbLink ? (thumbLink.querySelector('img') || thumbLink.querySelector('picture img')) : null;
              if (!imgEl) imgEl = item.querySelector('img') || item.querySelector('.thumb_image img') || item.querySelector('.prod_img img') || item.querySelector('picture img') || item.querySelector('.img_wrap img');
              if (imgEl) {
                const attrs = ['src', 'data-original', 'data-src', 'data-lazy-src', 'data-origin', 'data-url', 'data-img', 'data-image', 'data-lazy', 'data-srcset', 'data-original-src'];
                for (const attr of attrs) {
                  const val = imgEl.getAttribute(attr) || imgEl[attr];
                  if (val && typeof val === 'string' && val.trim() && !val.includes('noImg') && !val.includes('noData')) { image = val.trim(); break; }
                }
                if (!image && imgEl.srcset) { const m = imgEl.srcset.match(/https?:\/\/[^\s,]+/); if (m) image = m[0]; }
                if (image) {
                  if (image.startsWith('//')) image = 'https:' + image;
                  else if (image.startsWith('/')) image = 'https://img.danawa.com' + image;
                  if (image.includes('noImg') || image.includes('noData') || image.includes('placeholder')) image = '';
                }
              }
              if (!image && thumbLink) {
                const style = window.getComputedStyle(thumbLink);
                const bgImage = style.backgroundImage || thumbLink.style.backgroundImage;
                if (bgImage && bgImage !== 'none') {
                  const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                  if (urlMatch && urlMatch[1]) {
                    image = urlMatch[1];
                    if (image.startsWith('//')) image = 'https:' + image;
                    else if (image.startsWith('/')) image = 'https://img.danawa.com' + image;
                  }
                }
              }
              if (!image && nameEl) {
                const prodHref = nameEl.getAttribute('href') || '';
                const codeMatch = prodHref.match(/code=(\d+)/);
                if (codeMatch) {
                  const prodCode = codeMatch[1];
                  const cp = prodCode.match(/(\d{2})(\d{2})(\d{2})/);
                  if (cp) image = `https://img.danawa.com/prod_img/500000/${cp[1]}${cp[2]}${cp[3]}/img/${prodCode}_1.jpg?shrink=130:130`;
                }
              }
              const specEl = item.querySelector('.spec_list');
              const basicSpec = specEl?.textContent?.trim().replace(/\s+/g, ' ').replace(/\ub354\ubcf4\uae30/g, '') || '';
              let allSpecText = '';
              if (specEl) {
                const specParts = [];
                specEl.querySelectorAll('li, dd, dt, span, div').forEach(el => {
                  const text = el.textContent?.trim();
                  if (text && text.length > 0 && !text.match(/^(\ub354\ubcf4\uae30|\uc811\uae30)$/)) specParts.push(text);
                });
                if (specParts.length > 0) allSpecText = specParts.join('/');
              }
              const detailLink = nameEl?.getAttribute('href') || '';
              const prodCode = detailLink.match(/code=(\d+)/)?.[1] || '';
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;
              results.push({
                name,
                image,
                spec: allSpecText || basicSpec || '',
                price,
                prodCode,
                detailLink: detailLink ? (detailLink.startsWith('http') ? detailLink : `https://prod.danawa.com${detailLink}`) : '',
              });
            } catch (e) {}
          });
          return results;
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개 수집`);
        if (pageProducts.length === 0) { console.log('⚠️ 페이지에서 제품을 찾지 못함 - 크롤링 중단'); break; }
        products.push(...pageProducts);
        const hasNext = await page.evaluate(() => { const nextBtn = document.querySelector('.nav_next'); return nextBtn && !nextBtn.classList.contains('disabled'); });
        if (!hasNext && pageNum < maxPages) { console.log(`⏹️ 마지막 페이지 도달 (페이지 ${pageNum})`); break; }
        await sleep(2000);
      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 크롤링 실패:`, e.message);
        if (pageNum === 1) break;
      }
    }
  } catch (error) {
    console.error("❌ 크롤링 실패:", error.message);
  } finally {
    if (browser) await browser.close();
  }
  console.log(`🎉 총 ${products.length}개 제품 수집 완료`);
  return products;
}

function findBenchmarkScore(cpuName, benchmarks) {
  if (benchmarks.has(cpuName)) return benchmarks.get(cpuName);
  const normalizedCpuName = normalizeCpuName(cpuName);
  const cpuBrand = extractBrand(cpuName);

  const extractModelNumber = (name) => {
    const n = name.toUpperCase();
    const xeonE = n.match(/\b(E[3-9]|E5)-\s*(\d{4,})\s*([Vv]\d+)?\b/i);
    if (xeonE) return `${xeonE[1]}-${xeonE[2]}${xeonE[3] ? xeonE[3].toUpperCase() : ''}`.replace(/\s+/g, '').toUpperCase();
    const xeonX = n.match(/\b(X\d{4,})\b/i);
    if (xeonX) return xeonX[1].toUpperCase();
    const gSeries = n.match(/\b(G\d{4,})\b/i);
    if (gSeries) return gSeries[1].toUpperCase();
    const core2 = n.match(/\b([QE]\d{4,})\b/i);
    if (core2) return core2[1].toUpperCase();
    const patterns = [/\b(\d{4,}[A-Z0-9X3D]*)\b/i, /\b(\d{3}[A-Z0-9X3D]*)\b/i];
    for (const pattern of patterns) {
      const matches = n.match(pattern);
      if (matches && matches.length > 0) return matches.reduce((longest, current) => current.length > longest.length ? current : longest).toUpperCase();
    }
    return null;
  };

  const extractSuffix = (modelNumber) => modelNumber ? modelNumber.replace(/\d+/g, '').toUpperCase() : '';

  const extractSeries = (name) => {
    const n = name.toUpperCase();
    if (n.includes('RYZEN') || n.includes('\ub77c\uc774\uc824')) return 'RYZEN';
    if (n.includes('PHENOM')) return 'PHENOM';
    if (n.includes('ATHLON')) return 'ATHLON';
    if (n.includes('THREADRIPPER')) return 'THREADRIPPER';
    if (n.includes('EPYC')) return 'EPYC';
    if (n.includes('CORE I3') || n.includes('\ucf54\uc5b4I3') || n.includes('\ucf54\uc5b4 I3')) return 'CORE_I3';
    if (n.includes('CORE I5') || n.includes('\ucf54\uc5b4I5') || n.includes('\ucf54\uc5b4 I5')) return 'CORE_I5';
    if (n.includes('CORE I7') || n.includes('\ucf54\uc5b4I7') || n.includes('\ucf54\uc5b4 I7')) return 'CORE_I7';
    if (n.includes('CORE I9') || n.includes('\ucf54\uc5b4I9') || n.includes('\ucf54\uc5b4 I9')) return 'CORE_I9';
    if (n.includes('CORE ULTRA') || n.includes('ULTR')) return 'CORE_ULTRA';
    if (n.includes('CELERON') || n.includes('\uc140\ub7ec\ub860')) return 'CELERON';
    if (n.includes('PENTIUM') || n.includes('\ud3f0\ud2f0\uc5c4')) return 'PENTIUM';
    if (n.includes('XEON') || n.includes('\uc81c\uc628')) return 'XEON';
    if (n.includes('CORE2') || n.includes('\ucf54\uc5b42')) return 'CORE2';
    return null;
  };

  const cpuModel = extractModelNumber(cpuName);
  const cpuSeries = extractSeries(cpuName);

  if (cpuModel) {
    for (const [benchName, score] of benchmarks.entries()) {
      if (!cpuBrand) continue;
      const benchBrand = extractBrand(benchName);
      if (!benchBrand || cpuBrand !== benchBrand || benchBrand === "OTHER") continue;
      const benchModel = extractModelNumber(benchName);
      if (!benchModel) continue;
      const benchModelUpper = benchModel.toUpperCase();
      const benchSeries = extractSeries(benchName);
      if (cpuSeries && benchSeries && cpuSeries !== benchSeries) continue;
      if (cpuModel === benchModelUpper) { console.log(`✅ \uc815\ud655\ud55c \ubaa8\ub378 \ub9e4\uce6d: "${cpuName}" \u2194 "${benchName}" (${score}\uc810)`); return score; }
      if (cpuModel.includes('-') || benchModelUpper.includes('-')) continue;
      const cpuModelNum = cpuModel.replace(/[A-Z-]/g, '');
      const benchModelNum = benchModelUpper.replace(/[A-Z-]/g, '');
      if (cpuModelNum === benchModelNum && cpuModelNum.length >= 4) {
        if (extractSuffix(cpuModel) === extractSuffix(benchModelUpper)) {
          console.log(`⚠️ \ubaa8\ub378 \ubc88\ud638 \ub9e4\uce6d: "${cpuName}" \u2194 "${benchName}" (${score}\uc810)`);
          return score;
        }
      }
    }
  }

  const tokens = normalizedCpuName.split(/\s+/).filter(t => /\d/.test(t) && t.length > 1);
  for (const [benchName, score] of benchmarks.entries()) {
    if (!cpuBrand) continue;
    const benchBrand = extractBrand(benchName);
    if (!benchBrand || cpuBrand !== benchBrand || benchBrand === "OTHER") continue;
    const benchSeries = extractSeries(benchName);
    if (cpuSeries && benchSeries && cpuSeries !== benchSeries) continue;
    const benchModel = extractModelNumber(benchName);
    if (cpuModel && benchModel) {
      const benchModelUpper = benchModel.toUpperCase();
      if (cpuModel !== benchModelUpper) {
        if (cpuModel.includes('-') || benchModelUpper.includes('-')) continue;
        const cpuModelNum = cpuModel.replace(/[A-Z-]/g, '');
        const benchModelNum = benchModelUpper.replace(/[A-Z-]/g, '');
        if (cpuModelNum === benchModelNum && cpuModelNum.length >= 4) {
          if (extractSuffix(cpuModel) !== extractSuffix(benchModelUpper)) continue;
        } else continue;
      }
    }
    const normalizedBench = normalizeCpuName(benchName);
    const allTokensMatch = tokens.every(t => normalizedBench.includes(t));
    if (allTokensMatch && tokens.length >= 3) { console.log(`⚠️ \ubd80\ubd84 \ub9e4\uce6d: "${cpuName}" \u2194 "${benchName}" (${score}\uc810)`); return score; }
  }

  console.log(`❌ \ub9e4\uce6d \uc2e4\ud328: "${cpuName}"`);
  return 0;
}

async function saveToMongoDB(cpus, benchmarks, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cpu" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));
  let inserted = 0, updated = 0, withScore = 0, skipped = 0;

  for (const cpu of cpus) {
    if (!cpu.price || cpu.price === 0) { skipped++; continue; }
    const old = byName.get(cpu.name);
    const baseInfo = extractCpuInfo(cpu.name, cpu.spec);
    const crawledSpec = cpu.spec?.trim() || '';
    const hasDetailedSpec = crawledSpec.length > baseInfo.length && crawledSpec.length > 20;
    const benchScore = findBenchmarkScore(cpu.name, benchmarks);
    if (benchScore > 0) withScore++;
    if (!benchScore || benchScore < MIN_PASSMARK_SCORE_FOR_SAVE) { console.log(`⛔ \uc800\uc7a5 \uc81c\uc678 (PassMark ${benchScore} < ${MIN_PASSMARK_SCORE_FOR_SAVE}):`, cpu.name); continue; }

    let review = old?.review?.trim() ? old.review : "";
    let info = hasDetailedSpec ? crawledSpec : (old?.info?.trim() || baseInfo);

    if (ai) {
      const needsReview = !old?.review || old.review.trim() === "";
      const oldInfoTrimmed = old?.info?.trim() || "";
      const needsInfo = force || oldInfoTrimmed === "" || (hasDetailedSpec && oldInfoTrimmed !== crawledSpec) || (!hasDetailedSpec && oldInfoTrimmed === baseInfo.trim());
      if (needsReview || needsInfo) {
        const aiRes = await fetchAiOneLiner({ name: cpu.name, spec: hasDetailedSpec ? crawledSpec : cpu.spec });
        if (aiRes.review) review = aiRes.review;
        if (aiRes.info && aiRes.info.trim().length > info.length) info = aiRes.info;
        else if (hasDetailedSpec) info = crawledSpec;
      }
    } else {
      review = old?.review || review;
      info = hasDetailedSpec ? crawledSpec : (old?.info || info);
    }

    if (!info || info.trim() === "") info = baseInfo;
    if (!review || review.trim() === "") {
      const upperName = cpu.name.toUpperCase();
      let tag = "\uc77c\ubc18 \uc791\uc5c5\uacfc \uac00\ubc29\uc740 \uac8c\uc784\uc9c1\uc5d0 \uc801\ud569";
      if (/THREADRIPPER|EPYC/.test(upperName)) tag = "\uc6cc\ud06c\uc2a4\ud14c\uc774\uc158/\uc11c\ubc84\uae09 \uc5f0\uc0b0\uc5d0 \uc801\ud569";
      else if (/XEON/.test(upperName)) tag = "\uc11c\ubc84/\uc6cc\ud06c\uc2a4\ud14c\uc774\uc158 \uc6a9\ub3c4\uc5d0 \uc801\ud569";
      else if (/X3D/.test(upperName)) tag = "\uac8c\uc784\uc9c1 \uc131\ub2a5 \ucd5c\uc801\ud654 (\ub300\uc6a9\ub7c9 \ucf00\uc2dc)";
      else if (/K\b/.test(upperName)) tag = "\uc624\ubc84\ud074\ub7ed/\uac8c\uc784\uc9c1\uc5d0 \uc720\ub9ac";
      else if (/F\b/.test(upperName)) tag = "\ub0b4\uc7a5\uadf8\ub798\ud53d \uc5c6\uc74c, \uc678\uc7a5 GPU \uad8c\uc7a5";
      if (benchScore >= 45000) tag += ", \ud558\uc774\uc5d4\ub4dc \uc131\ub2a5";
      else if (benchScore >= 25000) tag += ", \uc0c1\uae09 \uc131\ub2a5";
      else if (benchScore >= 12000) tag += ", \uc911\uae09 \uc131\ub2a5";
      else tag += ", \ubcf4\uae09\ud615 \uc131\ub2a5";
      review = tag;
    }

    const { price: naverPrice, mallCount } = await fetchNaverPrice(cpu.name);
    const update = { category: "cpu", info, image: cpu.image, manufacturer: extractManufacturer(cpu.name), price: naverPrice, mallCount: mallCount || 0 };
    const hasExistingBench = old?.benchScore && old.benchScore > 0;
    if (!hasExistingBench) update.benchScore = benchScore;
    if (review) update.review = review;

    if (old) {
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update, $unset: { specSummary: "" } };
      if (naverPrice > 0 && naverPrice !== old.price) {
        const priceHistory = old.priceHistory || [];
        if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { $each: [{ date: today, price: naverPrice }], $slice: -90 } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
    } else {
      const priceHistory = naverPrice > 0 ? [{ date: new Date().toISOString().slice(0, 10), price: naverPrice }] : [];
      await col.insertOne({ name: cpu.name, ...update, priceHistory });
      inserted++;
    }
    if (ai) await sleep(200);
  }

  await col.updateMany({ category: "cpu", specSummary: { $exists: true } }, { $unset: { specSummary: "" } });

  const currentNames = new Set(cpus.map((c) => c.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) await col.deleteMany({ category: "cpu", name: { $in: toDelete } });

  console.log(`\n\uD83D\uDCC8 \ucd5c\uc885 \uacb0\uacfc: \uc0bd\uc785 ${inserted}\uac1c, \uc5c5\ub370\uc774\ud2b8 ${updated}\uac1c, \uc0ad\uc81c ${toDelete.length}\uac1c, \uac74\ub108\ub700 ${skipped}\uac1c`);
  console.log(`\uD83D\uDCCA \ubca4\uce58\ub9c8\ud06c \uc810\uc218: ${withScore}/${cpus.length}\uac1c \ub9e4\uce6d \uc644\ub8cc`);
}

router.post("/sync-cpus", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 15;
    const benchPages = parseInt(req.body?.benchPages) || 10;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;
    res.json({ message: `\u2705 CPU \ub3d9\uae30\ud654 \uc2dc\uc791 (\ub2e4\ub098\uc640: ${maxPages}p, \ubca4\uce58\ub9c8\ud06c: ${benchPages}p, AI: ${ai})` });
    setImmediate(async () => {
      try {
        console.log("\n=== CPU \ub3d9\uae30\ud654 \uc2dc\uc791 ===");
        const benchmarks = await crawlCpuBenchmark(benchPages);
        const cpus = await crawlDanawaCpus(maxPages);
        if (cpus.length === 0) { console.log("\u26d4 \ud06c\ub864\ub9c1\ub41c \ub370\uc774\ud130 \uc5c6\uc74c"); return; }
        await saveToMongoDB(cpus, benchmarks, { ai, force });
        invalidatePartsCache();
        console.log("\uD83C\uDF89 CPU \ub3d9\uae30\ud654 \uc644\ub8cc");
      } catch (err) {
        console.error("\u274c \ub3d9\uae30\ud654 \uc2e4\ud328:", err);
      }
    });
  } catch (err) {
    console.error("\u274c sync-cpus \uc2e4\ud328", err);
    res.status(500).json({ error: "sync-cpus \uc2e4\ud328" });
  }
});

export default router;
