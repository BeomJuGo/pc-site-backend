// routes/syncSTORAGE.js - 가격 제외 버전 (updatePrices.js가 가격 전담)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_SSD_URL = "https://prod.danawa.com/list/?cate=112760";
const DANAWA_HDD_URL = "https://prod.danawa.com/list/?cate=112763";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `스토리지 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/용량/인터페이스/속도>"}`;

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
    "삼성전자", "Samsung", "Western Digital", "WD", "Seagate", "씨게이트",
    "Crucial", "크루셜", "Kingston", "킹스턴", "SK하이닉스", "Toshiba",
    "Sabrent", "ADATA", "Corsair", "Intel", "Micron", "SanDisk"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "";
}

/* ==================== 스토리지 스펙 파싱 ==================== */
function parseStorageSpecs(name = "", spec = "", type = "SSD") {
  const combined = `${name} ${spec}`;
  const parts = [];

  // 용량
  const capacityMatch = combined.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  let capacity = "";
  if (capacityMatch) {
    const value = parseFloat(capacityMatch[1]);
    const unit = capacityMatch[2].toUpperCase();
    capacity = `${value}${unit}`;
    parts.push(`용량: ${capacity}`);
  }

  if (type === "SSD") {
    // 인터페이스
    if (/NVMe/i.test(combined)) parts.push("인터페이스: NVMe");
    else if (/SATA/i.test(combined)) parts.push("인터페이스: SATA");

    // 폼팩터
    if (/M\.2/i.test(combined)) parts.push("폼팩터: M.2");
    else if (/2\.5"/i.test(combined)) parts.push("폼팩터: 2.5\"");

    // PCIe Gen
    const pcieMatch = combined.match(/PCIe\s*(\d\.\d|[3-5])/i);
    if (pcieMatch) parts.push(`PCIe: Gen${pcieMatch[1]}`);

    // 읽기/쓰기 속도
    const readMatch = combined.match(/읽기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i);
    if (readMatch) parts.push(`읽기: ${readMatch[1]}MB/s`);

    const writeMatch = combined.match(/쓰기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i);
    if (writeMatch) parts.push(`쓰기: ${writeMatch[1]}MB/s`);

    // TBW
    const tbwMatch = combined.match(/TBW[:\s]*(\d+(?:,\d+)?)\s*TB/i);
    if (tbwMatch) parts.push(`TBW: ${tbwMatch[1]}TB`);

  } else if (type === "HDD") {
    // RPM
    const rpmMatch = combined.match(/(\d+)\s*RPM/i);
    if (rpmMatch) parts.push(`RPM: ${rpmMatch[1]}`);

    // 캐시
    const cacheMatch = combined.match(/캐시[:\s]*(\d+)\s*MB/i);
    if (cacheMatch) parts.push(`캐시: ${cacheMatch[1]}MB`);

    // 인터페이스
    if (/SATA/i.test(combined)) parts.push("인터페이스: SATA");
  }

  // 보증기간
  const warrantyMatch = combined.match(/(\d+)년\s*보증/i);
  if (warrantyMatch) parts.push(`보증: ${warrantyMatch[1]}년`);

  return {
    type,
    interface: type === "SSD"
      ? (/NVMe/i.test(combined) ? "NVMe" : "SATA")
      : "SATA",
    formFactor: /M\.2/i.test(combined) ? "M.2" : "2.5\"",
    capacity,
    pcieGen: type === "SSD" ? (combined.match(/PCIe\s*(\d\.\d|[3-5])/i)?.[1] || "") : "",
    readSpeed: type === "SSD" ? (combined.match(/읽기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i)?.[1] || "") : "",
    writeSpeed: type === "SSD" ? (combined.match(/쓰기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i)?.[1] || "") : "",
    tbw: type === "SSD" ? (combined.match(/TBW[:\s]*(\d+(?:,\d+)?)\s*TB/i)?.[1] || "") : "",
    rpm: type === "HDD" ? (combined.match(/(\d+)\s*RPM/i)?.[1] || "") : "",
    cache: type === "HDD" ? (combined.match(/캐시[:\s]*(\d+)\s*MB/i)?.[1] || "") : "",
    warranty: warrantyMatch?.[1] || "",
    info: parts.join(", "),
    specText: spec
  };
}

/* ==================== 스토리지 성능 점수 계산 ==================== */
function calculateStorageScore(name = "", spec = "", type = "SSD") {
  const combined = `${name} ${spec}`.toUpperCase();
  let score = 0;
  
  if (type === "SSD") {
    // 인터페이스 기반 기본 점수
    if (/NVME/i.test(combined)) {
      score = 50000; // NVMe 기본 점수
      
      // PCIe Gen 보정
      const pcieGenMatch = combined.match(/PCIe\s*(?:GEN\s*)?(\d\.\d|[3-5])/i);
      if (pcieGenMatch) {
        const gen = parseFloat(pcieGenMatch[1]);
        if (gen >= 5.0) score += 30000; // PCIe 5.0
        else if (gen >= 4.0) score += 20000; // PCIe 4.0
        else if (gen >= 3.0) score += 10000; // PCIe 3.0
      }
    } else if (/SATA/i.test(combined)) {
      score = 20000; // SATA 기본 점수
    }
    
    // 읽기 속도 (MB/s)
    const readMatch = combined.match(/읽기[:\s]*(\d+(?:,\d+)?)\s*MB\/S/i);
    if (readMatch) {
      const readSpeed = parseInt(readMatch[1].replace(/,/g, ''));
      if (readSpeed > 0) {
        score += Math.min(readSpeed / 10, 5000); // 최대 5000점
      }
    }
    
    // 쓰기 속도 (MB/s)
    const writeMatch = combined.match(/쓰기[:\s]*(\d+(?:,\d+)?)\s*MB\/S/i);
    if (writeMatch) {
      const writeSpeed = parseInt(writeMatch[1].replace(/,/g, ''));
      if (writeSpeed > 0) {
        score += Math.min(writeSpeed / 10, 5000); // 최대 5000점
      }
    }
    
  } else if (type === "HDD") {
    // HDD 기본 점수
    score = 10000;
    
    // RPM 보정
    const rpmMatch = combined.match(/(\d+)\s*RPM/i);
    if (rpmMatch) {
      const rpm = parseInt(rpmMatch[1]);
      if (rpm >= 7200) score += 5000; // 7200 RPM
      else if (rpm >= 5400) score += 2000; // 5400 RPM
      else score += 1000; // 5400 미만
    }
    
    // 캐시 보정
    const cacheMatch = combined.match(/캐시[:\s]*(\d+)\s*MB/i);
    if (cacheMatch) {
      const cache = parseInt(cacheMatch[1]);
      score += Math.min(cache / 10, 2000); // 최대 2000점
    }
  }
  
  return Math.max(score, 0);
}

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaStorage(url, type = "SSD", maxPages = 10) {
  console.log(`🔍 다나와 ${type} 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ],
      defaultViewport: { width: 1280, height: 720 },
      headless: true,
      ignoreHTTPSErrors: true,
    });

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
          // 안정화된 네비게이션 (about:blank → 대상 URL, 재시도 포함)
          const navigateWithRetry = async (targetUrl) => {
            let attempts = 3;
            while (attempts--) {
              try {
                await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(1000);
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(3000);
                await page.waitForSelector(".main_prodlist .prod_item, ul.product_list > li.prod_item", { timeout: 20000 });
                return true;
              } catch (e) {
                console.log(`⚠️ 초기 네비게이션 실패: ${e.message}`);
                if (!attempts) throw e;
              }
            }
          };

          await navigateWithRetry(url);

          // 스크롤로 lazy-load 유도
          for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(400);
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

        await page.waitForSelector(".main_prodlist .prod_item, ul.product_list > li.prod_item", { timeout: 20000 });

        const items = await page.evaluate(() => {
          const nodeList = document.querySelectorAll("ul.product_list > li.prod_item, .main_prodlist .product_list .prod_item");
          const liList = Array.from(nodeList);
          return liList.map((li) => {
            const nameEl = li.querySelector("p.prod_name a");
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
            const specEl = li.querySelector("div.spec_list");

            // 가격 정보 추출
            const priceEl = li.querySelector('.price_sect a strong');
            let price = 0;
            if (priceEl) {
              const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
              price = parseInt(priceText, 10) || 0;
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
async function saveToMongoDB(storages, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "storage" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${storages.length}개`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const storage of storages) {
    // 가격 필터링: 1만원 이하 또는 100만원 이상인 품목은 저장하지 않음
    const price = storage.price || 0;
    if (price > 0 && (price <= 10000 || price >= 1000000)) {
      skipped++;
      console.log(`⏭️  건너뜀 (가격 범위 초과): ${storage.name} (${price.toLocaleString()}원)`);
      continue;
    }

    const old = byName.get(storage.name);

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: storage.name,
          spec: storage.spec,
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    // 스토리지 성능 점수 계산
    const storageScore = calculateStorageScore(
      storage.name,
      storage.spec,
      storage.specs?.type || "SSD"
    );
    
    const update = {
      category: "storage",
      info: storage.info,
      image: storage.image,
      manufacturer: extractManufacturer(storage.name),
      specs: storage.specs,
      price: storage.price || 0, // 가격 정보 추가
      benchmarkScore: storageScore > 0 ? { "storagescore": storageScore } : undefined,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      // 가격 히스토리 업데이트 (새로운 가격이 있고 기존과 다를 때)
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };

      if (storage.price > 0 && storage.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        const alreadyExists = priceHistory.some(p => p.date === today);

        if (!alreadyExists) {
          ops.$push = { priceHistory: { date: today, price: storage.price } };
        }
      }

      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${storage.name} (가격: ${(storage.price ?? 0).toLocaleString()}원)`);
    } else {
      // 신규 추가 시 가격 히스토리 초기화
      const priceHistory = [];
      if (storage.price > 0) {
        const today = new Date().toISOString().slice(0, 10);
        priceHistory.push({ date: today, price: storage.price });
      }

      await col.insertOne({
        name: storage.name,
        ...update,
        priceHistory,
      });
      inserted++;
      console.log(`🆕 신규 추가: ${storage.name} (가격: ${(storage.price ?? 0).toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(storages.map((s) => s.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "storage", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개 (가격 범위 초과)`
  );
  console.log(`💰 가격 정보도 함께 크롤링하여 저장 완료`);
  if (skipped > 0) {
    console.log(`⚠️  가격이 1만원 이하 또는 100만원 이상인 ${skipped}개 항목은 저장하지 않았습니다 (액세서리, 서버용 스토리지 등)`);
  }
}

/* ==================== Express 라우터 ==================== */
router.post("/sync-storage", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({
      message: `✅ 다나와 스토리지 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)`,
    });

    setImmediate(async () => {
      try {
        console.log("\n=== 스토리지 동기화 시작 ===");

        // SSD 크롤링
        const ssdProducts = await crawlDanawaStorage(DANAWA_SSD_URL, "SSD", maxPages);
        const ssdData = ssdProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "SSD");
          return {
            name: p.name,
            image: p.image,
            info: specs.info,
            spec: specs.specText,
            price: p.price || 0,
            specs: {
              type: specs.type,
              interface: specs.interface,
              formFactor: specs.formFactor,
              capacity: specs.capacity,
              pcieGen: specs.pcieGen,
              readSpeed: specs.readSpeed,
              writeSpeed: specs.writeSpeed,
              tbw: specs.tbw,
              warranty: specs.warranty
            }
          };
        });

        // HDD 크롤링
        const hddProducts = await crawlDanawaStorage(DANAWA_HDD_URL, "HDD", maxPages);
        const hddData = hddProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "HDD");
          return {
            name: p.name,
            image: p.image,
            info: specs.info,
            spec: specs.specText,
            price: p.price || 0,
            specs: {
              type: specs.type,
              interface: specs.interface,
              formFactor: specs.formFactor,
              capacity: specs.capacity,
              rpm: specs.rpm,
              cache: specs.cache,
              warranty: specs.warranty
            }
          };
        });

        const allStorage = [...ssdData, ...hddData];

        if (allStorage.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(allStorage, { ai, force });
        console.log("🎉 스토리지 동기화 완료 (가격 정보 포함)");
        console.log("💰 가격 정보가 함께 크롤링되어 저장되었습니다");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-storage 실패", err);
    res.status(500).json({ error: "sync-storage 실패" });
  }
});

export default router;
