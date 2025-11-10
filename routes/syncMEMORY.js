// routes/syncMEMORY.js - 가격 제외 버전 (updatePrices.js가 가격 전담)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();

const DANAWA_BASE_URL = "https://prod.danawa.com/list/?cate=112752";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `메모리(RAM) "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<DDR타입/속도/용량/용도>"}`;

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

/* ==================== 메모리 정보 추출 ==================== */
function extractMemoryInfo(spec = "") {
  const parts = [];

  // DDR 타입
  const ddrMatch = spec.match(/DDR[2-5]/i);
  if (ddrMatch) parts.push(`Type: ${ddrMatch[0].toUpperCase()}`);

  // 속도
  const speedMatch = spec.match(/(\d{4,5})\s*MHz/i);
  if (speedMatch) parts.push(`Speed: ${speedMatch[1]} MHz`);

  // 용량
  const capacityMatch = spec.match(/(\d+GB(?:\(\d+Gx\d+\))?)/i);
  if (capacityMatch) parts.push(`Capacity: ${capacityMatch[1]}`);

  // 램타이밍
  const timingMatch = spec.match(/CL(\d+(?:-\d+)*)/i);
  if (timingMatch) parts.push(`CL: ${timingMatch[1]}`);

  return parts.join(", ");
}

/* ==================== 메모리 성능 점수 계산 ==================== */
function calculateMemoryScore(name = "", spec = "") {
  const combined = `${name} ${spec}`.toUpperCase();
  
  // DDR 타입 추출
  const ddrMatch = combined.match(/DDR([2-5])/i);
  const ddrType = ddrMatch ? parseInt(ddrMatch[1]) : 4; // 기본값 DDR4
  
  // 속도 추출 (MHz)
  const speedMatch = combined.match(/(\d{4,5})\s*MHZ/i);
  const speed = speedMatch ? parseInt(speedMatch[1]) : 0;
  
  // CL 타이밍 추출
  const clMatch = combined.match(/CL(\d+)/i);
  const cl = clMatch ? parseInt(clMatch[1]) : null;
  
  // 기본 점수 계산: DDR 타입 * 10000 + 속도 * 2
  let score = ddrType * 10000;
  if (speed > 0) {
    score += speed * 2;
  }
  
  // CL 타이밍 보정 (낮을수록 좋음, DDR4/DDR5 기준)
  if (cl !== null) {
    if (ddrType === 5) {
      // DDR5: CL30-40이 일반적, 낮을수록 좋음
      if (cl <= 30) score += 500; // 우수
      else if (cl <= 36) score += 200; // 양호
      else if (cl <= 40) score += 50; // 보통
    } else if (ddrType === 4) {
      // DDR4: CL14-18이 일반적
      if (cl <= 14) score += 500; // 우수
      else if (cl <= 16) score += 200; // 양호
      else if (cl <= 18) score += 50; // 보통
    }
  }
  
  // 최소 점수 보장 (DDR2: 20000, DDR3: 30000, DDR4: 40000, DDR5: 50000)
  const minScore = ddrType * 10000;
  return Math.max(score, minScore);
}

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaMemory(maxPages = 10) {
  console.log(`🔍 다나와 메모리 크롤링 시작 (최대 ${maxPages}페이지)`);
  console.log(`💡 가격은 제외 (updatePrices.js가 별도로 업데이트)`);

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
      'google-analytics.com','analytics.google.com','googletagmanager.com','google.com/ccm',
      'ad.danawa.com','dsas.danawa.com','service-api.flarelane.com','doubleclick.net',
      'adnxs.com','googlesyndication.com','scorecardresearch.com','facebook.net'
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
              await page.goto(DANAWA_BASE_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
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

          await page.waitForSelector('.main_prodlist .prod_item', {
            timeout: 30000,
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
                  const items = document.querySelectorAll('.main_prodlist .prod_item');
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
        }

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

              const specEl = item.querySelector('.spec_list');
              const spec = specEl?.textContent
                ?.trim()
                .replace(/\s+/g, ' ')
                .replace(/더보기/g, '');

              // 가격 정보 추출
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) {
                const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
                price = parseInt(priceText, 10) || 0;
              }

              results.push({ name, image, spec: spec || '', price });
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

        try {
          const screenshot = await page.screenshot({ encoding: 'base64' });
          console.log('📸 스크린샷 저장됨 (base64, 처음 100자):', screenshot.substring(0, 100));
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

  console.log(`🎉 총 ${products.length}개 제품 수집 완료 (제품명, 스펙, 이미지만)`);
  return products;
}

/* ==================== MongoDB 저장 ==================== */
async function saveToMongoDB(memories, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "memory" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${memories.length}개`);

  let inserted = 0;
  let updated = 0;

  for (const memory of memories) {
    const old = byName.get(memory.name);
    const info = extractMemoryInfo(memory.spec);

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: memory.name,
          spec: memory.spec,
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    // 메모리 성능 점수 계산
    const memoryScore = calculateMemoryScore(memory.name, memory.spec);
    
    const update = {
      category: "memory",
      info,
      image: memory.image,
      price: memory.price || 0, // 가격 정보 추가
      benchmarkScore: memoryScore > 0 ? { "memoryscore": memoryScore } : undefined,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      // 가격 히스토리 업데이트 (새로운 가격이 있고 기존과 다를 때)
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };

      if (memory.price > 0 && memory.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        const alreadyExists = priceHistory.some(p => p.date === today);

        if (!alreadyExists) {
          ops.$push = { priceHistory: { date: today, price: memory.price } };
        }
      }

      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${memory.name} (가격: ${memory.price.toLocaleString()}원)`);
    } else {
      // 신규 추가 시 가격 히스토리 초기화
      const priceHistory = [];
      if (memory.price > 0) {
        const today = new Date().toISOString().slice(0, 10);
        priceHistory.push({ date: today, price: memory.price });
      }

      await col.insertOne({
        name: memory.name,
        ...update,
        priceHistory,
      });
      inserted++;
      console.log(`🆕 삽입: ${memory.name} (가격: ${memory.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(memories.map((m) => m.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "memory", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개`
  );
  console.log(`💰 가격 정보도 함께 크롤링하여 저장 완료`);
}

/* ==================== 라우터 ==================== */
router.post("/sync-memory", async (req, res) => {
  try {
    const maxPages = Number(req?.body?.pages) || 3;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({
      message: `✅ 다나와 메모리 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)`,
    });

    setImmediate(async () => {
      try {
        const memories = await crawlDanawaMemory(maxPages);

        if (memories.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(memories, { ai, force });
        console.log("🎉 메모리 동기화 완료 (가격 정보 포함)");
        console.log("💰 가격 정보가 함께 크롤링되어 저장되었습니다");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-memory 실패", err);
    res.status(500).json({ error: "sync-memory 실패" });
  }
});

export default router;
