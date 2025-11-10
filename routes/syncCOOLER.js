// routes/syncCOOLER.js - 가격 제외 버전 (updatePrices.js가 가격 전담)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();

const DANAWA_COOLER_URL = "https://prod.danawa.com/list/?cate=11236855";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `쿨러 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/소켓/TDP/높이>"}`;

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

/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name) {
  const brands = [
    "써멀라이트", "Thermalright", "딥쿨", "Deepcool", "쿨러마스터", "Cooler Master",
    "녹투아", "Noctua", "비쿱", "Be Quiet", "커세어", "Corsair",
    "NZXT", "Arctic", "Zalman", "ID-COOLING", "Enermax", "Scythe"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "";
}

/* ==================== 쿨러 정보 추출 ==================== */
function extractCoolerInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const parts = [];

  // 쿨러 타입
  if (/수냉|AIO|일체형\s*수냉/i.test(combined)) {
    parts.push("수냉 쿨러");

    // 라디에이터 크기
    const radMatch = combined.match(/(\d{3})mm|(\d{2,3})\s*(?:mm)?/i);
    if (radMatch) {
      const size = radMatch[1] || radMatch[2];
      if (size === "120" || size === "240" || size === "280" || size === "360" || size === "420") {
        parts.push(`라디에이터: ${size}mm`);
      }
    }
  } else {
    parts.push("공랭 쿨러");
  }

  // TDP 지원
  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  if (tdpMatch) {
    parts.push(`TDP: ${tdpMatch[1]}W`);
  }

  // 높이
  const heightMatch = combined.match(/높이[:\s]*(\d{2,3})mm?|(\d{2,3})\s*mm/i);
  if (heightMatch) {
    const height = heightMatch[1] || heightMatch[2];
    if (parseInt(height) > 50 && parseInt(height) < 200) {
      parts.push(`높이: ${height}mm`);
    }
  }

  // 소켓 지원
  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1x]/i.test(combined)) sockets.push("LGA115x");

  if (sockets.length > 0) {
    parts.push(`소켓: ${sockets.join(", ")}`);
  }

  // RGB
  if (/ARGB|RGB/i.test(combined)) {
    parts.push("RGB");
  }

  return parts.join(", ");
}

/* ==================== 쿨러 스펙 파싱 (호환성 체크용) ==================== */
function parseCoolerSpecs(name = "", spec = "") {
  const combined = `${name} ${spec}`;

  // 쿨러 타입
  const isWaterCooling = /수냉|AIO|일체형\s*수냉/i.test(combined);

  // 소켓 지원
  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1x]/i.test(combined)) sockets.push("LGA115x");

  // TDP
  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  const tdpW = tdpMatch ? parseInt(tdpMatch[1]) : 0;

  // 높이
  const heightMatch = combined.match(/높이[:\s]*(\d{2,3})mm?|(\d{2,3})\s*mm/i);
  const heightMm = heightMatch ? parseInt(heightMatch[1] || heightMatch[2]) : 0;

  return {
    type: isWaterCooling ? "수냉" : "공랭",
    sockets,
    tdpW,
    heightMm,
    info: extractCoolerInfo(name, spec),
    specText: spec
  };
}

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaCoolers(maxPages = 10) {
  console.log(`🔍 다나와 쿨러 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();

    const page = await browser.newPage();

    // 로케일/타임존 및 탐지 우회
    await page.setDefaultTimeout(60000);
    await page.setDefaultNavigationTimeout(60000);
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
          let retries = 3;
          let loaded = false;

          while (retries > 0 && !loaded) {
            try {
              console.log(`🔄 1페이지 로딩 시도 (남은 재시도: ${retries})`);
              await page.goto(DANAWA_COOLER_URL, {
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
                  const items = document.querySelectorAll('ul.product_list > li.prod_item');
                  return items.length > 0;
                }, { timeout: 30000 });

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
                  const items = document.querySelectorAll('ul.product_list > li.prod_item');
                  return items.length > 0;
                }, { timeout: 30000 });

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
            const specEl = li.querySelector("div.spec_list");

            // 가격 정보 추출
            const priceEl = li.querySelector('.price_sect a strong');
            let price = 0;
            if (priceEl) {
              const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
              price = parseInt(priceText, 10) || 0;
            }

            // 이미지 추출 개선: 여러 선택자와 속성 확인
            let image = '';

            // 방법 1: thumb_link 내부 이미지
            const thumbLink = li.querySelector('a.thumb_link') || li.querySelector('.thumb_link');
            let imgEl = null;

            if (thumbLink) {
              imgEl = thumbLink.querySelector('img') || thumbLink.querySelector('picture img');
            }

            // 방법 2: 직접 이미지 요소 찾기
            if (!imgEl) {
              imgEl = li.querySelector('img') ||
                li.querySelector('.thumb_image img') ||
                li.querySelector('.prod_img img') ||
                li.querySelector('picture img') ||
                li.querySelector('.img_wrap img');
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
              const bgEl = thumbLink || li.querySelector('.thumb_image') || li.querySelector('.prod_img');
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
            const nameEl = li.querySelector("p.prod_name a");
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

            return {
              name: nameEl?.textContent?.trim() || "",
              image: image,
              spec: specEl?.textContent?.trim() || "",
              price: price,
            };
          });
        });

        products.push(...items.filter((p) => p.name));
        console.log(`✅ 페이지 ${pageNum}: ${items.length}개 수집 완료`);

        await sleep(2000);

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);

        try {
          const screenshot = await page.screenshot({ encoding: 'base64' });
          console.log('📸 스크린샷 저장됨');
        } catch (screenshotErr) {
          console.log('⚠️ 스크린샷 저장 실패');
        }

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

/* ==================== MongoDB 저장 ==================== */
async function saveToMongoDB(coolers, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cooler" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${coolers.length}개`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const cooler of coolers) {
    const old = byName.get(cooler.name);
    const specs = parseCoolerSpecs(cooler.name, cooler.spec);

    // 소켓 정보가 없는 품목은 저장하지 않음 (케이스 쿨러, 서멀구리스, 방열판 등 제외)
    if (!specs.sockets || specs.sockets.length === 0) {
      skipped++;
      console.log(`⏭️  건너뜀 (소켓 정보 없음): ${cooler.name}`);
      continue;
    }

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: cooler.name,
          spec: cooler.spec,
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "cooler",
      info: specs.info,
      image: cooler.image,
      manufacturer: extractManufacturer(cooler.name),
      specs: {
        type: specs.type,
        sockets: specs.sockets,
        tdpW: specs.tdpW,
        heightMm: specs.heightMm,
        specText: specs.specText
      },
      price: cooler.price || 0, // 가격 정보 추가
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      // 가격 히스토리 업데이트 (새로운 가격이 있고 기존과 다를 때)
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };

      if (cooler.price > 0 && cooler.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        const alreadyExists = priceHistory.some(p => p.date === today);

        if (!alreadyExists) {
          ops.$push = { priceHistory: { date: today, price: cooler.price } };
        }
      }

      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${cooler.name} (가격: ${cooler.price.toLocaleString()}원)`);
    } else {
      // 신규 추가 시 가격 히스토리 초기화
      const priceHistory = [];
      if (cooler.price > 0) {
        const today = new Date().toISOString().slice(0, 10);
        priceHistory.push({ date: today, price: cooler.price });
      }

      await col.insertOne({
        name: cooler.name,
        ...update,
        priceHistory,
      });
      inserted++;
      console.log(`🆕 신규 추가: ${cooler.name} (가격: ${cooler.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(coolers.map((c) => c.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cooler", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개 (소켓 정보 없음)`
  );
  console.log(`💰 가격 정보도 함께 크롤링하여 저장 완료`);
  if (skipped > 0) {
    console.log(`⚠️  소켓 정보가 없는 ${skipped}개 항목은 저장하지 않았습니다 (케이스 쿨러, 서멀구리스, 방열판 등)`);
  }
}

/* ==================== Express 라우터 ==================== */
router.post("/sync-cooler", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({
      message: `✅ 다나와 쿨러 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)`,
    });

    setImmediate(async () => {
      try {
        console.log("\n=== 쿨러 동기화 시작 ===");
        const coolers = await crawlDanawaCoolers(maxPages);

        if (coolers.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(coolers, { ai, force });
        console.log("🎉 쿨러 동기화 완료 (가격 정보 포함)");
        console.log("💰 가격 정보가 함께 크롤링되어 저장되었습니다");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-cooler 실패", err);
    res.status(500).json({ error: "sync-cooler 실패" });
  }
});

export default router;
