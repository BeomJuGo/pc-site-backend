// routes/backfillImage.js - 이미지가 없는 품목들의 이미지를 다나와에서 가져오기
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 카테고리별 다나와 URL 매핑
const CATEGORY_URLS = {
  cpu: "https://prod.danawa.com/list/?cate=112747",
  gpu: "https://prod.danawa.com/list/?cate=112753",
  motherboard: "https://prod.danawa.com/list/?cate=112751",
  memory: "https://prod.danawa.com/list/?cate=112752",
  psu: "https://prod.danawa.com/list/?cate=112750",
  storage: "https://prod.danawa.com/list/?cate=112749",
  case: "https://prod.danawa.com/list/?cate=112748",
  cooler: "https://prod.danawa.com/list/?cate=11236855",
};

/* ==================== 다나와에서 제품 이미지 검색 ==================== */
async function searchImageFromDanawa(productName, category) {
  let browser;
  try {
    browser = await launchBrowser();

    const page = await browser.newPage();
    await page.setDefaultTimeout(30000);
    await page.setDefaultNavigationTimeout(30000);
    await page.emulateTimezone('Asia/Seoul');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // 요청 차단
    const blockHosts = [
      'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
      'ad.danawa.com', 'dsas.danawa.com', 'service-api.flarelane.com',
      'doubleclick.net', 'adnxs.com', 'googlesyndication.com'
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

    // 카테고리 페이지로 이동
    const categoryUrl = CATEGORY_URLS[category];
    if (!categoryUrl) {
      console.log(`   ⚠️  알 수 없는 카테고리: ${category}`);
      return "";
    }

    await page.goto(categoryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // 검색창에 제품명 입력
    try {
      // 검색창 찾기 (다나와 검색창 선택자)
      const searchInput = await page.waitForSelector('input#searchKeyword, input.search_word, input[type="text"][name="keyword"]', { timeout: 5000 });
      
      if (searchInput) {
        // 검색어 입력
        await page.type('input#searchKeyword, input.search_word, input[type="text"][name="keyword"]', productName, { delay: 100 });
        await sleep(500);
        
        // 검색 버튼 클릭 또는 Enter
        await page.keyboard.press('Enter');
        await sleep(3000);
      } else {
        // 검색창이 없으면 URL로 직접 검색
        const searchUrl = `${categoryUrl}&keyword=${encodeURIComponent(productName)}`;
        await page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      }
    } catch (e) {
      // 검색창이 없으면 URL로 직접 검색
      const searchUrl = `${categoryUrl}&keyword=${encodeURIComponent(productName)}`;
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }

    // 검색 결과 로딩 대기
    await page.waitForSelector('ul.product_list > li.prod_item, .main_prodlist .prod_item', { timeout: 10000 }).catch(() => {});

    // 이미지 로딩을 위해 스크롤
    await page.evaluate(() => {
      const lazyImages = document.querySelectorAll('img[data-original], img[data-src], img[data-lazy-src]');
      lazyImages.forEach(img => {
        const src = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src) img.src = src;
      });
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(2000);

    // 첫 번째 검색 결과에서 이미지 추출
    const image = await page.evaluate((targetName) => {
      const items = document.querySelectorAll('ul.product_list > li.prod_item, .main_prodlist .prod_item');
      
      for (const item of items) {
        const nameEl = item.querySelector('.prod_name a, p.prod_name a');
        const name = nameEl?.textContent?.trim() || "";
        
        // 제품명이 유사하면 (부분 일치로 완화)
        if (name && targetName.split(' ').some(word => word.length > 2 && name.includes(word))) {
          // 이미지 추출
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
            
            if (!image && imgEl.srcset) {
              const srcsetMatch = imgEl.srcset.match(/https?:\/\/[^\s,]+/);
              if (srcsetMatch) image = srcsetMatch[0];
            }
            
            if (image) {
              if (image.startsWith('//')) image = 'https:' + image;
              else if (image.startsWith('/')) image = 'https://img.danawa.com' + image;
              if (image.includes('noImg') || image.includes('noData') || image.includes('placeholder')) {
                image = '';
              } else {
                return image;
              }
            }
          }
          
          // 방법 3: 제품 링크에서 제품 ID 추출
          if (!image && nameEl) {
            const prodHref = nameEl.getAttribute('href') || '';
            const codeMatch = prodHref.match(/code=(\d+)/);
            if (codeMatch) {
              const prodCode = codeMatch[1];
              const codeParts = prodCode.match(/(\d{2})(\d{2})(\d{2})/);
              if (codeParts) {
                const [_, a, b, c] = codeParts;
                return `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`;
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
                return `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`;
              }
            }
          }
        }
      }
      return "";
    }, productName);

    await browser.close();
    return image || "";
  } catch (error) {
    console.log(`   ⚠️  이미지 검색 실패: ${error.message}`);
    if (browser) await browser.close();
    return "";
  }
}

router.post("/backfill-image", async (req, res) => {
  const { category = null, limit = 100, force = false } = req.body || {};
  try {
    const db = getDB();
    const col = db.collection("parts");

    // 이미지가 없거나 빈 문자열인 항목 찾기
    const query = {
      ...(category ? { category } : {}),
      $or: [
        { image: { $exists: false } },
        { image: "" },
        { image: null },
      ],
    };

    const targets = await col
      .find(query)
      .project({ name: 1, category: 1, image: 1 })
      .limit(parseInt(limit))
      .toArray();

    res.json({ message: `이미지 백필 시작: ${targets.length}건`, category, limit });

    setImmediate(async () => {
      let success = 0;
      let skipped = 0;
      let failed = 0;
      
      console.log(`\n🖼️  이미지 백필 시작: ${targets.length}개 항목 처리 예정`);
      console.log(`📋 카테고리: ${category || '전체'}, 제한: ${limit}개, 강제 재생성: ${force ? '예' : '아니오'}\n`);

      for (const t of targets) {
        // force가 false이고 이미지가 있으면 건너뛰기
        if (!force && t.image && t.image.trim() !== "") {
          skipped++;
          console.log(`⏭️  건너뜀: ${t.name} (이미 이미지가 있음)`);
          continue;
        }

        console.log(`🔍 이미지 검색 중: [${t.category}] ${t.name.slice(0, 50)}${t.name.length > 50 ? '...' : ''}`);

        const image = await searchImageFromDanawa(t.name, t.category);

        if (image && image.trim() !== "") {
          await col.updateOne({ _id: t._id }, { $set: { image: image } });
          success++;
          console.log(`   ✅ 성공: ${image.slice(0, 80)}${image.length > 80 ? '...' : ''}`);
        } else {
          failed++;
          console.log(`   ❌ 실패: 이미지를 찾을 수 없음`);
        }

        console.log(""); // 빈 줄
        await sleep(1000); // 각 검색 사이 대기
      }

      console.log(`\n📊 이미지 백필 완료 통계:`);
      console.log(`   ✅ 성공: ${success}개`);
      console.log(`   ❌ 실패: ${failed}개`);
      console.log(`   ⏭️  건너뜀: ${skipped}개`);
      console.log(`   📦 전체: ${targets.length}개`);
      console.log(`✅ 이미지 백필 완료: ${success}/${targets.length}\n`);
    });
  } catch (err) {
    console.error("❌ backfill-image 실패", err);
    res.status(500).json({ error: "backfill-image 실패" });
  }
});

export default router;

