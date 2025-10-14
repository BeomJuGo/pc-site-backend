// routes/updatePrices.js - 다나와 크롤링 버전 (네이버 API 대체)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { getDB } from "../db.js";

const router = express.Router();

/* ========================= 다나와 카테고리 URL ========================= */
const DANAWA_URLS = {
  gpu: "https://prod.danawa.com/list/?cate=112753",         // 그래픽카드
  cpu: "https://prod.danawa.com/list/?cate=112747",         // CPU
  motherboard: "https://prod.danawa.com/list/?cate=112751", // 메인보드
  memory: "https://prod.danawa.com/list/?cate=112752",      // 메모리
  psu: "https://prod.danawa.com/list/?cate=112777",         // 파워
  case: "https://prod.danawa.com/list/?cate=112775",        // 케이스
  cooler: "https://prod.danawa.com/list/?cate=11236855",    // 쿨러
  storage: "https://prod.danawa.com/list/?cate=112760"      // SSD
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ========================= 칩셋/모델명 추출 함수 ========================= */

// GPU 칩셋 추출 (RTX 5090, RX 7900 XT 등)
function extractGpuChipset(name) {
  const n = name.toUpperCase();
  
  // NVIDIA (RTX/GTX)
  const nvidiaMatch = n.match(/\b(RTX|GTX)\s*-?\s*(\d{3,4})\s*(TI|SUPER)?\b/);
  if (nvidiaMatch) {
    return nvidiaMatch[0].replace(/\s+/g, " ").trim();
  }
  
  // AMD (RX)
  const amdMatch = n.match(/\bRX\s*-?\s*(\d{3,4})\s*(XT|XTX)?\b/);
  if (amdMatch) {
    return amdMatch[0].replace(/\s+/g, " ").trim();
  }
  
  // Intel (ARC)
  const intelMatch = n.match(/\bARC\s*[A-Z]?\d{3}\b/);
  if (intelMatch) {
    return intelMatch[0].replace(/\s+/g, " ").trim();
  }
  
  return null;
}

// CPU 모델명 추출 (Ryzen 7 7700X, i5-13400F 등)
function extractCpuModel(name) {
  const n = name.toUpperCase();
  
  // AMD Ryzen
  const ryzenMatch = n.match(/\bRYZEN\s*[357579]\s*\d{3,4}[XGTE]?\b/);
  if (ryzenMatch) {
    return ryzenMatch[0].replace(/\s+/g, " ").trim();
  }
  
  // Intel Core
  const intelMatch = n.match(/\bI[3579]-\d{4,5}[KFTS]?\b/);
  if (intelMatch) {
    return intelMatch[0].replace(/\s+/g, " ").trim();
  }
  
  return null;
}

// 메모리 스펙 추출 (DDR5-5600 32GB)
function extractMemorySpec(name) {
  const n = name.toUpperCase();
  const tokens = [];
  
  // DDR 타입 + 속도
  const ddrMatch = n.match(/\bDDR[345](?:-\d{4,5})?\b/);
  if (ddrMatch) tokens.push(ddrMatch[0]);
  
  // 용량
  const capacityMatch = n.match(/\b(\d{1,3})\s*GB\b/);
  if (capacityMatch) tokens.push(capacityMatch[1] + "GB");
  
  return tokens.length > 0 ? tokens.join(" ") : null;
}

// 메인보드 칩셋 추출 (B650, Z790 등)
function extractBoardChipset(name) {
  const n = name.toUpperCase();
  const chipsetMatch = n.match(/\b([ABXZ]\d{3}[E]?|H\d{3})\b/);
  return chipsetMatch ? chipsetMatch[0] : null;
}

// PSU 용량 추출 (750W, 850W 등)
function extractPsuWattage(name) {
  const n = name.toUpperCase();
  const wattMatch = n.match(/\b(\d{3,4})\s*W\b/);
  return wattMatch ? wattMatch[1] + "W" : null;
}

// 범용 매칭 함수 (카테고리별 핵심 키워드 추출)
function extractCoreIdentifier(name, category) {
  switch (category) {
    case "gpu":
      return extractGpuChipset(name);
    case "cpu":
      return extractCpuModel(name);
    case "memory":
      return extractMemorySpec(name);
    case "motherboard":
      return extractBoardChipset(name);
    case "psu":
      return extractPsuWattage(name);
    case "case":
    case "cooler":
    case "storage":
      // 케이스/쿨러/스토리지는 제품명 전체 사용 (브랜드 제거)
      return name.replace(/^(NZXT|CORSAIR|LIAN\s*LI|SAMSUNG|WD|CRUCIAL|NOCTUA|DEEPCOOL)\s*/i, "").trim();
    default:
      return name;
  }
}

/* ========================= 다나와 크롤링 ========================= */
async function crawlDanawaCategory(category) {
  const url = DANAWA_URLS[category];
  if (!url) {
    console.log(`⚠️ 지원하지 않는 카테고리: ${category}`);
    return [];
  }

  console.log(`\n🔍 [${category}] 다나와 크롤링 시작: ${url}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    // 리소스 차단으로 속도 향상
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000); // 페이지 로딩 대기

    // 상품 목록 추출
    const products = await page.evaluate(() => {
      const items = document.querySelectorAll('.product_list .prod_item');
      return Array.from(items).map((item) => {
        const nameEl = item.querySelector('.prod_name a');
        const priceEl = item.querySelector('.price_sect strong');
        
        const name = nameEl?.textContent?.trim() || '';
        const priceText = priceEl?.textContent?.replace(/[^0-9]/g, '') || '0';
        const price = parseInt(priceText, 10);

        return { name, price };
      }).filter(p => p.name && p.price > 0);
    });

    console.log(`✅ [${category}] ${products.length}개 상품 크롤링 완료`);
    return products;

  } catch (error) {
    console.error(`❌ [${category}] 크롤링 실패:`, error.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/* ========================= 칩셋별 최저가 매칭 ========================= */
function findLowestPriceForPart(dbPart, crawledProducts, category) {
  const coreId = extractCoreIdentifier(dbPart.name, category);
  
  if (!coreId) {
    console.log(`⚠️ [${category}] 코어 식별 실패: ${dbPart.name}`);
    return null;
  }

  console.log(`   🔍 매칭 시도: "${dbPart.name}" → 코어식별: "${coreId}"`);

  // 동일한 칩셋/모델을 가진 제품들 필터링
  const matchingProducts = crawledProducts.filter((p) => {
    const productCoreId = extractCoreIdentifier(p.name, category);
    return productCoreId === coreId;
  });

  if (matchingProducts.length === 0) {
    console.log(`   ⛔ 매칭 제품 없음`);
    return null;
  }

  // 최저가 찾기
  const sorted = matchingProducts.sort((a, b) => a.price - b.price);
  const lowestPrice = sorted[0].price;
  const lowestProduct = sorted[0].name;

  console.log(`   ✅ 매칭 제품 ${matchingProducts.length}개 중 최저가: ${lowestPrice.toLocaleString()}원`);
  console.log(`      → ${lowestProduct}`);

  return { price: lowestPrice, matchCount: matchingProducts.length };
}

/* ========================= DB 업데이트 ========================= */
async function updatePricesFromDanawa() {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  const categories = ["gpu", "cpu", "motherboard", "memory", "psu", "case", "cooler", "storage"];
  
  console.log(`\n📦 다나와 가격 업데이트 시작 (${categories.length}개 카테고리)`);
  console.log(`📅 날짜: ${today}\n`);

  let totalSuccess = 0;
  let totalFail = 0;

  for (const category of categories) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📂 카테고리: ${category.toUpperCase()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // 1) 다나와 크롤링
    const crawledProducts = await crawlDanawaCategory(category);
    
    if (crawledProducts.length === 0) {
      console.log(`⛔ 크롤링 결과 없음, 다음 카테고리로...`);
      continue;
    }

    // 2) DB에서 해당 카테고리 부품 가져오기
    const dbParts = await col.find({ category }).toArray();
    console.log(`\n📋 DB 부품: ${dbParts.length}개`);

    // 3) 각 부품의 최저가 찾기 및 업데이트
    let successCount = 0;
    let failCount = 0;

    for (const part of dbParts) {
      const result = findLowestPriceForPart(part, crawledProducts, category);

      if (!result) {
        console.log(`   ⛔ [${part.name}] 가격 찾기 실패`);
        failCount++;
        continue;
      }

      const { price } = result;
      const already = (part.priceHistory || []).some((p) => p.date === today);

      const ops = { $set: { price } };
      if (!already) {
        ops.$push = { priceHistory: { date: today, price } };
      }

      await col.updateOne({ _id: part._id }, ops);
      successCount++;
    }

    console.log(`\n📊 [${category}] 결과: 성공 ${successCount}개, 실패 ${failCount}개`);
    totalSuccess += successCount;
    totalFail += failCount;

    // 카테고리 간 간격 (API 부하 방지)
    await sleep(2000);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🎉 전체 업데이트 완료`);
  console.log(`   ✅ 성공: ${totalSuccess}개`);
  console.log(`   ⛔ 실패: ${totalFail}개`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  return { success: totalSuccess, fail: totalFail };
}

/* ========================= 라우터 ========================= */
router.post("/update-prices", async (req, res) => {
  try {
    res.json({
      message: "✅ 다나와 가격 업데이트 시작",
      info: "백그라운드에서 크롤링 진행 중입니다. 완료까지 5-10분 소요됩니다."
    });

    // 백그라운드 실행
    setImmediate(async () => {
      try {
        await updatePricesFromDanawa();
        console.log("✅ 가격 업데이트 완전 완료!");
      } catch (error) {
        console.error("❌ 가격 업데이트 중 오류:", error);
      }
    });

  } catch (error) {
    console.error("❌ update-prices 라우터 오류:", error);
    res.status(500).json({ error: "가격 업데이트 실패" });
  }
});

export default router;
