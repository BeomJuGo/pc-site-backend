// routes/syncGPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DANAWA_GPU_URL = "https://prod.danawa.com/list/?cate=112753";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV_TIMEOUT = Number(process.env.PUPPETEER_NAV_TIMEOUT || 150000);
// 3DMark 점수 부착 임계값(이 미만이면 benchmarkScore는 생략, 품목은 저장)
const MIN_3DMARK_SCORE_TO_ATTACH = 6000;

// 이름 간소화 (필터 조건에 사용)
const simplifyForFilter = (name) => {
  return name
    .replace(/NVIDIA GeForce |AMD Radeon /gi, "")
    .replace(/\b(TI|XT|SUPER|PRO|Ultra|GA\d+)\b/gi, " $1")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
};

// 제품명 규칙 검증 (완화)
const isValidGPUName = (name) => {
  const upper = name.toUpperCase();
  // 기본적으로 RTX/RX로 시작하고 3~5자리 숫자를 포함하면 유효로 간주
  return /(RTX|RX)\s*\d{3,5}/i.test(upper);
};

// 이름 정규화: 브랜드(시리즈) + 모델 + 핵심 접미사만 남김
const normalizeGpuKey = (rawName = "") => {
  const n = rawName
    .toUpperCase()
    .replace(/NVIDIA GEFORCE|GEFORCE|NVIDIA|AMD RADEON|RADEON/g, "")
    .replace(/LAPTOP|MOBILE|NOTEBOOK|DESKTOP|OEM|FOUNDERS|EDITION|GDDR\d|PCI-?E|PCIE|LP|LPX|MINI|ITX|OC|DUAL|TRIPLE|TURBO|VENTUS|EAGLE|GAMING|TUF|ROG|MECH|WINDFORCE|HELLHOUND|PULSE|RED DEVIL|FIGHTER|JETSTREAM|PHOENIX|AERO|VENTURA|SPECTRIX|MERC|STEEL LEGEND|PGD/g, "")
    .replace(/\b(\d+\s?GB)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 시리즈 식별
  const series = /(RTX|RX)/.exec(n)?.[1] || "";
  // 모델 숫자 추출 (3~5자리)
  const model = /\b(\d{3,5})\b/.exec(n)?.[1] || "";
  // 핵심 접미사
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
  }

  return parts.join(" ").trim();
};

// 제외해야 할 GPU (워크스테이션용 등)
const isUnwantedGPU = (name) =>
  /rtx\s*4500|radeon\s*pro|ada generation|titan|\bD$/i.test(name);

// GPU 점수 크롤링 (topcpu.net)
async function fetchGPUs() {
  const url = "https://www.topcpu.net/ko/gpu-r/3dmark-time-spy-desktop";
  const html = await axios.get(url).then((res) => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];
  const nameSet = new Set();

  // 점수 유효성: 3DMark Time Spy 데스크탑 일반 범위
  const isValidTimeSpyScore = (num) => num >= 2000 && num <= 60000;

  $("div.flex.flex-col, li, tr, .flex.flex-row").each((_, el) => {
    // 이름: 링크 텍스트 우선, 없으면 굵은 텍스트
    const name = (
      $(el).find("a").first().text() ||
      $(el).find("strong").first().text() ||
      ""
    ).trim();

    if (!name) return;

    // 점수 추출: 점수는 보통 이름 요소 근처의 굵은 숫자(span.font-bold)에 표시됨
    let score = 0;
    const scoreText = $(el).find('span.font-bold').first().text().replace(/,/g, '').trim();
    const parsed = parseInt(scoreText, 10);
    if (!isNaN(parsed) && isValidTimeSpyScore(parsed)) {
      score = parsed;
    }

    const simplified = simplifyForFilter(name);

    if (!name || !score) return;

    // 점수 범위 검증
    if (!isValidTimeSpyScore(score)) return;

    if (!isValidGPUName(simplified))
      return console.log("⛔ 제외 (형식 불일치):", name);
    if (isUnwantedGPU(name))
      return console.log("⛔ 제외 (비주류):", name);

    const base = simplified.toLowerCase();
    if (nameSet.has(base))
      return console.log("⛔ 제외 (중복):", name);
    nameSet.add(base);

    console.log(`✅ GPU 크롤링: "${name}" → 점수: ${score}`);
    gpuList.push({ name, score, key: normalizeGpuKey(name) });
  });

  console.log("✅ 크롤링 완료, 유효 GPU 수:", gpuList.length);
  return gpuList;
}

/* ==================== 다나와 GPU 크롤링 (가격/이미지/스펙) ==================== */
async function crawlDanawaGpus(maxPages = 10) {
  console.log(`🔍 다나와 GPU 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();

    const page = await browser.newPage();

    await page.setDefaultTimeout(NAV_TIMEOUT);
    await page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await page.emulateTimezone('Asia/Seoul');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

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
          // 안정화된 네비게이션 (재시도 포함)
          let retries = 3;
          let loaded = false;
          while (retries > 0 && !loaded) {
            try {
              await page.goto(DANAWA_GPU_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
              loaded = true;
              console.log('✅ 페이지 로딩 완료');
            } catch (e) {
              retries--;
              console.log(`⚠️ 로딩 재시도 (남은 횟수: ${retries})`);
              if (retries === 0) throw e;
              await sleep(2000);
            }
          }

          await page.waitForSelector('.main_prodlist .prod_item', { timeout: NAV_TIMEOUT / 3 }).catch(() => {
            console.log('⚠️ 제품 리스트 로딩 지연');
          });

          // 이미지 로딩을 위해 추가 대기 및 스크롤
          await page.evaluate(() => {
            // 모든 lazy loading 이미지 강제 로드
            const lazyImages = document.querySelectorAll('img[data-original], img[data-src], img[data-lazy-src]');
            lazyImages.forEach(img => {
              const src = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
              if (src) {
                img.src = src;
              }
            });
          });

          // 스크롤하여 lazy loading 트리거
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
          });
          await sleep(3000);
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await sleep(2000);

          // 이미지가 로드될 때까지 대기
          await page.evaluate(async () => {
            const images = Array.from(document.querySelectorAll('img'));
            await Promise.all(images.map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 500);
              });
            }));
          });
        } else {
          // AJAX 페이지네이션 처리
          try {
            const pageSelector = `a.num[page="${pageNum}"]`;
            const pageExists = await page.evaluate((selector) => !!document.querySelector(selector), pageSelector);
            if (pageExists) {
              await page.click(pageSelector);
              await page.waitForTimeout(5000);
              await page.waitForFunction(() => document.querySelectorAll('.main_prodlist .prod_item').length > 0, { timeout: NAV_TIMEOUT / 3 });
            } else {
              // movePage/goPage/changePage 호출
              await page.evaluate((p) => {
                if (typeof movePage === 'function') movePage(p);
                else if (typeof goPage === 'function') goPage(p);
                else if (typeof changePage === 'function') changePage(p);
                else throw new Error('페이지 이동 함수를 찾을 수 없음');
              }, pageNum);
              await page.waitForTimeout(5000);
              await page.waitForFunction(() => document.querySelectorAll('.main_prodlist .prod_item').length > 0, { timeout: NAV_TIMEOUT / 3 });
            }
          } catch (e) {
            console.log(`⚠️ 페이지 ${pageNum} 이동 실패: ${e.message}`);
            continue;
          }
        }

        // 항목 추출
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

              // 방법 4: thumb_link의 href에서 제품 ID 추출
              if (!image && thumbLink) {
                const href = thumbLink.getAttribute('href') || '';
                // 다나와 제품 링크 패턴: /prod/view.php?code=...
                const codeMatch = href.match(/code=(\d+)/);
                if (codeMatch) {
                  const prodCode = codeMatch[1];
                  // 다나와 이미지 URL 패턴 시도
                  const codeParts = prodCode.match(/(\d{2})(\d{2})(\d{2})/);
                  if (codeParts) {
                    const [_, a, b, c] = codeParts;
                    image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`;
                  }
                }
                // prod_img 패턴
                if (!image && href.includes('/prod_img/')) {
                  const match = href.match(/\/prod_img\/([^\/]+)/);
                  if (match) {
                    image = `https://img.danawa.com/prod_img/500000/${match[1]}/img/${match[1]}_1.jpg?shrink=130:130`;
                  }
                }
              }

              // 방법 5: 제품명 링크에서 추출
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
              const specEl = item.querySelector('.spec_list');
              const spec = specEl?.textContent?.trim().replace(/\s+/g, ' ').replace(/더보기/g, '') || '';
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) {
                const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
                price = parseInt(priceText, 10) || 0;
              }
              results.push({ name, image, spec, price });
            } catch (_) { }
          });
          return results;
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개 수집`);
        if (pageProducts.length === 0) break;
        products.push(...pageProducts);
        await sleep(2000);
      } catch (e) {
        console.log(`❌ 페이지 ${pageNum} 처리 실패: ${e.message}`);
        if (pageNum === 1) break;
      }
    }
  } catch (error) {
    console.error("❌ GPU 크롤링 실패:", error.message);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`🎉 총 ${products.length}개 GPU 제품 수집 완료`);
  return products;
}

const extractManufacturer = (name = "") => {
  const n = name.toUpperCase();
  // NVIDIA 확인
  if (n.includes("NVIDIA") || n.includes("지포스") || n.includes("GEFORCE") || n.includes("RTX") || n.includes("GTX")) {
    return "NVIDIA";
  }
  // AMD 확인 (라데온, RX 시리즈 포함)
  if (n.includes("AMD") || n.includes("RADEON") || n.includes("라데온") || /RX\s*\d+/.test(n)) {
    return "AMD";
  }
  return "";
}

// GPT 요약
/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `GPU(그래픽카드) "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<VRAM/클럭/쿠다코어/전력>"}`;

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
        specSummary: parsed.specSummary?.trim() || "",
      };
    } catch (e) {
      await sleep(800 * Math.pow(2, i));
    }
  }
  return { review: "", specSummary: "" };
}

// MongoDB 저장: 가격/이미지/점수/리뷰 포함, 가격 히스토리 반영
async function saveToDB(gpus, danawaProducts, options = {}) {
  const { ai = true, force = false } = options;
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "gpu" }).toArray();
  const currentNames = new Set(danawaProducts.map((g) => g.name));

  // 점수 맵 구성 (정규화 키 → 최고 점수)
  const scoreByKey = new Map();
  for (const g of gpus) {
    const key = g.key || normalizeGpuKey(g.name);
    if (!key) continue;
    const prev = scoreByKey.get(key) || 0;
    if (g.score > prev) scoreByKey.set(key, g.score);
  }

  for (const p of danawaProducts) {
    // 가격이 0원인 품목은 저장하지 않음
    if (!p.price || p.price === 0) {
      console.log(`⏭️  건너뜀 (가격 0원): ${p.name}`);
      continue;
    }

    const old = existing.find((e) => e.name === p.name);
    const key = normalizeGpuKey(p.name);
    const score = key ? (scoreByKey.get(key) || 0) : 0;

    // 임계값 미만이면 benchmarkScore는 저장하지 않음(품목은 저장)

    let review = "";
    let specSummary = p.spec || "";

    if (ai) {
      // review나 specSummary가 비어있으면 항상 채우기
      const needsReview = !old?.review || old.review.trim() === "";
      const needsSpecSummary = !old?.specSummary || old.specSummary.trim() === "";

      if (needsReview || needsSpecSummary || force) {
        const aiRes = await fetchAiOneLiner({
          name: p.name,
          spec: p.spec || "",
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || p.spec || "";
      } else {
        review = old.review || "";
        specSummary = old.specSummary || p.spec || "";
      }
    } else {
      // ai가 false여도 기존 데이터가 있으면 유지
      review = old?.review || "";
      specSummary = old?.specSummary || p.spec || "";
    }

    // Fallback: review가 비어있으면 기본값 생성
    if (!review || review.trim() === "") {
      const upperName = p.name.toUpperCase();
      let tag = "게이밍 및 멀티미디어 작업에 적합";
      if (/RTX\s*4090|RTX\s*4080|RX\s*7900/i.test(upperName)) tag = "최고 성능 게이밍 및 4K 렌더링에 최적";
      else if (/RTX\s*4070|RTX\s*4060|RX\s*7800|RX\s*7700/i.test(upperName)) tag = "고성능 게이밍 및 콘텐츠 제작에 적합";
      else if (/RTX\s*3060|RTX\s*3050|RX\s*6600/i.test(upperName)) tag = "중급 게이밍 및 일반 작업에 적합";
      else if (/GTX|RX\s*5/i.test(upperName)) tag = "보급형 게이밍 및 경량 작업에 적합";

      if (score && score >= MIN_3DMARK_SCORE_TO_ATTACH) {
        if (score >= 20000) tag += ", 하이엔드 성능";
        else if (score >= 12000) tag += ", 상급 성능";
        else if (score >= 8000) tag += ", 중급 성능";
        else tag += ", 보급형 성능";
      }
      review = tag;
    }

    const today = new Date().toISOString().slice(0, 10);

    // 기존 벤치마크 점수가 있으면 유지 (CPU와 동일한 로직)
    const hasExistingBench = old?.benchmarkScore?.["3dmarkscore"] && old.benchmarkScore["3dmarkscore"] > 0;
    const benchmarkScore = hasExistingBench
      ? old.benchmarkScore
      : (score >= MIN_3DMARK_SCORE_TO_ATTACH ? { "3dmarkscore": score } : undefined);

    const update = {
      category: "gpu",
      image: p.image,
      price: p.price || 0,
      manufacturer: extractManufacturer(p.name),
      review: review,
      specSummary: specSummary,
      ...(benchmarkScore ? { benchmarkScore } : {}),
    };

    if (old) {
      const ops = { $set: update };
      if (p.price > 0 && p.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        const already = priceHistory.some(ph => ph.date === today);
        if (!already) {
          ops.$push = { priceHistory: { date: today, price: p.price } };
        }
      }
      await col.updateOne({ _id: old._id }, ops);
      console.log("🔁 업데이트됨:", p.name);
    } else {
      await col.insertOne({
        name: p.name,
        ...update,
        priceHistory: p.price > 0 ? [{ date: today, price: p.price }] : [],
      });
      console.log("🆕 삽입됨:", p.name);
    }

    if (ai) await sleep(200);
  }

  // 기존 DB에 있지만 새 목록에 없는 GPU 삭제
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "gpu", name: { $in: toDelete } });
    console.log("🗑️ 삭제됨:", toDelete.length, "개");
  }
}

// 실행 라우터
router.post("/sync-gpus", async (req, res) => {
  const maxPages = Number(req?.body?.pages) || 5;
  const ai = req.body?.ai !== false;
  const force = req.body?.force === true;

  res.json({ message: `✅ GPU 동기화 시작 (pages=${maxPages}, AI: ${ai}, 가격 포함)` });
  setImmediate(async () => {
    const [scores, danawa] = await Promise.all([
      fetchGPUs(),
      crawlDanawaGpus(maxPages),
    ]);

    await saveToDB(scores, danawa, { ai, force });
    console.log("🎉 모든 GPU 정보 저장 완료 (가격 정보 및 AI 한줄평 포함)");
  });
});

export default router;
