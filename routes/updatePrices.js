import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { getDB } from "../db.js";

const router = express.Router();

/* ========================= 다나와 카테고리 URL ========================= */
const DANAWA_URLS = {
  gpu: "https://prod.danawa.com/list/?cate=112753",
  cpu: "https://prod.danawa.com/list/?cate=112747",
  motherboard: "https://prod.danawa.com/list/?cate=112751",
  memory: "https://prod.danawa.com/list/?cate=112752",
  psu: "https://prod.danawa.com/list/?cate=112777",
  case: "https://prod.danawa.com/list/?cate=112775",
  cooler: "https://prod.danawa.com/list/?cate=11236855",
  storage: "https://prod.danawa.com/list/?cate=112760"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ========================= 개선된 제품명 정규화 ========================= */
function normalizeProductName(name) {
  return name
    .toUpperCase()
    .replace(/\s+/g, " ")  // 여러 공백 → 하나로
    .replace(/[()[\]{}]/g, "") // 괄호 제거
    .replace(/[-_]/g, " ")  // 하이픈/언더스코어 → 공백
    .trim();
}

/* ========================= 개선된 칩셋/모델명 추출 ========================= */
function extractGpuChipset(name) {
  const n = normalizeProductName(name);
  
  // NVIDIA (RTX/GTX)
  const nvidiaMatch = n.match(/\b(RTX|GTX)\s*(\d{3,4})\s*(TI|SUPER)?\b/);
  if (nvidiaMatch) {
    return nvidiaMatch[0].replace(/\s+/g, " ").trim();
  }
  
  // AMD (RX)
  const amdMatch = n.match(/\bRX\s*(\d{3,4})\s*(XT|XTX)?\b/);
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

/* ========================= 다나와 크롤링 (페이지 수 증가) ========================= */
async function crawlDanawaCategory(category) {
  const url = DANAWA_URLS[category];
  if (!url) {
    console.log(`⚠️ 지원하지 않는 카테고리: ${category}`);
    return [];
  }

  console.log(`🔍 [${category}] 다나와 크롤링 시작: ${url}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const allProducts = [];
    const maxPages = 15; // ⭐ 10페이지까지 크롤링

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const pageUrl = `${url}&page=${pageNum}`;
      console.log(`   📄 페이지 ${pageNum}/${maxPages} 크롤링 중...`);

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(3000);

        const pageProducts = await page.evaluate(() => {
  const items = [];
  const rows = document.querySelectorAll(".product_list .prod_item");

  rows.forEach((row) => {
    try {
      const nameEl = row.querySelector(".prod_name a");
      const priceEl = row.querySelector(".price_sect a strong");  // ✅ 수정

      if (nameEl && priceEl) {
        const name = nameEl.textContent.trim();
        const priceText = priceEl.textContent.replace(/[^0-9]/g, "");
        const price = parseInt(priceText, 10);

        if (name && price > 0) {
          items.push({ name, price });
        }
      }
    } catch (err) {
      // 개별 항목 파싱 실패 무시
    }
  });

  return items;
});

        allProducts.push(...pageProducts);
        console.log(`   ✅ ${pageProducts.length}개 제품 수집 (누적: ${allProducts.length}개)`);

        // 마지막 페이지 도달 확인
        const hasNextPage = await page.evaluate(() => {
          const nextBtn = document.querySelector(".number_wrap .next_btn");
          return nextBtn && !nextBtn.classList.contains("disabled");
        });

        if (!hasNextPage) {
          console.log(`   ℹ️ 마지막 페이지 도달 (${pageNum}페이지)`);
          break;
        }

        await sleep(2000);
      } catch (err) {
        console.log(`   ⚠️ 페이지 ${pageNum} 크롤링 실패:`, err.message);
        break;
      }
    }

    console.log(`✅ [${category}] ${allProducts.length}개 상품 크롤링 완료`);
    return allProducts;

  } catch (error) {
    console.error(`❌ [${category}] 크롤링 오류:`, error.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/* ========================= 개선된 유사도 계산 ========================= */
function calculateSimilarity(str1, str2) {
  const s1 = normalizeProductName(str1);
  const s2 = normalizeProductName(str2);

  // ⭐ 정확히 일치하면 1.0 반환
  if (s1 === s2) return 1.0;

  // Levenshtein 거리 계산
  const matrix = Array.from({ length: s1.length + 1 }, (_, i) =>
    Array.from({ length: s2.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}

/* ========================= GPU 칩셋 기반 매칭 ========================= */
function findLowestPriceForGpu(dbPart, crawledProducts) {
  const chipset = extractGpuChipset(dbPart.name);
  
  if (!chipset) {
    console.log(`   🔍 [제품명 매칭] "${dbPart.name}"`);
    return findLowestPriceByProductName(dbPart, crawledProducts);
  }

  console.log(`   🔍 [칩셋 매칭] "${dbPart.name}" → "${chipset}"`);

  const normalizedChipset = normalizeProductName(chipset);
  const matchingProducts = crawledProducts.filter(p => {
    const normalizedProduct = normalizeProductName(p.name);
    return normalizedProduct.includes(normalizedChipset);
  });

  if (matchingProducts.length === 0) {
    console.log(`   ⛔ 칩셋 매칭 실패, 제품명 매칭 시도...`);
    return findLowestPriceByProductName(dbPart, crawledProducts);
  }

  // 최저가 찾기
  const lowest = matchingProducts.sort((a, b) => a.price - b.price)[0];
  console.log(`   ✅ 매칭 ${matchingProducts.length}개 중 최저가: ${lowest.price.toLocaleString()}원`);
  console.log(`      → ${lowest.name}`);

  return { price: lowest.price, matchCount: matchingProducts.length };
}

/* ========================= 제품명 기반 매칭 (개선) ========================= */
function findLowestPriceByProductName(dbPart, crawledProducts) {
  console.log(`   🔍 [제품명 매칭] "${dbPart.name}"`);

  // ⭐ 1단계: 정확한 일치 먼저 찾기
  const exactMatch = crawledProducts.find(p => 
    normalizeProductName(p.name) === normalizeProductName(dbPart.name)
  );
  
  if (exactMatch) {
    console.log(`   ✅ 정확한 매칭: ${exactMatch.price.toLocaleString()}원`);
    console.log(`      → ${exactMatch.name}`);
    return { price: exactMatch.price, matchCount: 1 };
  }

  // ⭐ 2단계: 유사도 매칭 (임계값: 65%)
  const similarities = crawledProducts.map((p) => ({
    product: p,
    similarity: calculateSimilarity(dbPart.name, p.name)
  }));

  const matchingProducts = similarities.filter((s) => s.similarity >= 0.65);

  if (matchingProducts.length === 0) {
    console.log(`   ⛔ 유사 제품 없음 (유사도 < 65%)`);
    
    // ⭐ 3단계: 키워드 매칭
    const keywords = dbPart.name.split(/\s+/).filter(k => k.length > 3);
    const keywordMatches = crawledProducts.filter(p => {
      const pName = normalizeProductName(p.name);
      return keywords.every(k => pName.includes(normalizeProductName(k)));
    });
    
    if (keywordMatches.length > 0) {
      const lowest = keywordMatches.sort((a, b) => a.price - b.price)[0];
      console.log(`   ⚠️ 키워드 매칭: ${lowest.price.toLocaleString()}원`);
      console.log(`      → ${lowest.name}`);
      return { price: lowest.price, matchCount: keywordMatches.length };
    }
    
    return null;
  }

  const bestMatch = matchingProducts.sort((a, b) => b.similarity - a.similarity)[0];
  const { product, similarity } = bestMatch;

  console.log(`   ✅ 유사도 매칭 (${(similarity * 100).toFixed(1)}%): ${product.price.toLocaleString()}원`);
  console.log(`      → ${product.name}`);

  return { price: product.price, matchCount: matchingProducts.length };
}

/* ========================= 가격 찾기 (카테고리별 분기) ========================= */
function findLowestPriceForPart(dbPart, crawledProducts, category) {
  if (category === "gpu") {
    return findLowestPriceForGpu(dbPart, crawledProducts);
  } else {
    return findLowestPriceByProductName(dbPart, crawledProducts);
  }
}

/* ========================= DB 업데이트 ========================= */
async function updatePricesFromDanawa() {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  const categories = ["gpu", "cpu", "motherboard", "memory", "psu", "case", "cooler", "storage"];

  console.log(`📦 다나와 가격 업데이트 시작 (${categories.length}개 카테고리)`);
  console.log(`📅 날짜: ${today}`);
  console.log(`🔧 개선사항: 정확한 매칭 우선, 10페이지 크롤링, 3단계 매칭`);

  let totalSuccess = 0;
  let totalFail = 0;

  for (const category of categories) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📂 카테고리: ${category.toUpperCase()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const crawledProducts = await crawlDanawaCategory(category);

    if (crawledProducts.length === 0) {
      console.log(`⛔ 크롤링 결과 없음, 다음 카테고리로...`);
      continue;
    }

    const dbParts = await col.find({ category }).toArray();
    console.log(`📋 DB 부품: ${dbParts.length}개`);

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

    console.log(`📊 [${category}] 결과: 성공 ${successCount}개, 실패 ${failCount}개`);
    console.log(`   매칭율: ${((successCount / dbParts.length) * 100).toFixed(1)}%`);
    totalSuccess += successCount;
    totalFail += failCount;

    await sleep(2000);
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🎉 전체 업데이트 완료`);
  console.log(`   ✅ 성공: ${totalSuccess}개`);
  console.log(`   ⛔ 실패: ${totalFail}개`);
  console.log(`   📈 전체 매칭율: ${((totalSuccess / (totalSuccess + totalFail)) * 100).toFixed(1)}%`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return { success: totalSuccess, fail: totalFail };
}

/* ========================= 라우터 ========================= */
router.post("/update-prices", async (req, res) => {
  try {
    res.json({
      message: "✅ 다나와 가격 업데이트 시작 (개선 버전 v2)",
      info: "백그라운드에서 크롤링 진행 중입니다. 완료까지 15-20분 소요됩니다.",
      improvements: [
        "정확한 제품명 매칭 우선",
        "크롤링 범위 10페이지로 확대", 
        "3단계 매칭 시스템 (정확한 매칭 → 유사도 65% → 키워드)",
        "syncGPU 제외한 나머지는 제품명 그대로 매칭"
      ]
    });

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
