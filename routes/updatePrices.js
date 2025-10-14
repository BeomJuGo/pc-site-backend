// routes/updatePrices.js - 다나와 크롤링 버전 (네이버 API 대체)
// 
// 【매칭 전략】
// - GPU, CPU: 칩셋/모델 기준 (여러 제조사 제품 중 최저가)
//   예) "RTX 5090" → MSI, ASUS, GIGABYTE 등 모든 RTX 5090 중 최저가
// 
// - Memory, Motherboard, PSU, Case, Cooler, Storage: 제품명 유사도 기준
//   예) DB의 "삼성전자 DDR5-5600 32GB" → 다나와에서 동일 제품명 찾기
//   (이미 sync 파일들로 다나와에서 정확한 제품명을 크롤링하여 DB에 저장했기 때문)
//
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
// GPU, CPU만 사용 (나머지 카테고리는 제품명 직접 매칭)

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

// 칩셋/모델명 추출 (GPU, CPU만 사용)
function extractCoreIdentifier(name, category) {
  switch (category) {
    case "gpu":
      return extractGpuChipset(name);
    default:
      return null; // 나머지 카테고리는 제품명 매칭 사용
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

/* ========================= 제품명 유사도 계산 ========================= */
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().replace(/\s+/g, "");
  const s2 = str2.toLowerCase().replace(/\s+/g, "");
  
  // 완전 일치
  if (s1 === s2) return 1.0;
  
  // 한쪽이 다른쪽을 포함
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  // Levenshtein 거리 기반 유사도
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));
  
  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  
  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

/* ========================= 칩셋별/제품명별 최저가 매칭 ========================= */
function findLowestPriceForPart(dbPart, crawledProducts, category) {
  // GPU, CPU: 칩셋/모델 기준 (여러 제조사 중 최저가)
  if (category === "gpu") {
    const coreId = extractCoreIdentifier(dbPart.name, category);
    
    if (!coreId) {
      console.log(`   ⚠️ 코어 식별 실패: ${dbPart.name}`);
      return null;
    }

    console.log(`   🔍 [칩셋 매칭] "${dbPart.name}" → "${coreId}"`);

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

    console.log(`   ✅ 매칭 ${matchingProducts.length}개 중 최저가: ${lowestPrice.toLocaleString()}원`);
    console.log(`      → ${lowestProduct}`);

    return { price: lowestPrice, matchCount: matchingProducts.length };
  }
  
  // 나머지 카테고리: 제품명 기준 (정확한 제품명 매칭)
  console.log(`   🔍 [제품명 매칭] "${dbPart.name}"`);
  
  // 유사도 계산하여 가장 유사한 제품 찾기
  const similarities = crawledProducts.map((p) => ({
    product: p,
    similarity: calculateSimilarity(dbPart.name, p.name)
  }));
  
  // 유사도 80% 이상인 제품들만 필터링
  const matchingProducts = similarities.filter((s) => s.similarity >= 0.8);
  
  if (matchingProducts.length === 0) {
    console.log(`   ⛔ 유사 제품 없음 (유사도 < 80%)`);
    return null;
  }
  
  // 가장 유사한 제품 선택
  const bestMatch = matchingProducts.sort((a, b) => b.similarity - a.similarity)[0];
  const { product, similarity } = bestMatch;
  
  console.log(`   ✅ 매칭 성공 (유사도 ${(similarity * 100).toFixed(1)}%): ${product.price.toLocaleString()}원`);
  console.log(`      → ${product.name}`);
  
  return { price: product.price, matchCount: matchingProducts.length };
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
