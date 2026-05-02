// routes/syncPSU.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser, setupPage, navigateToDanawaPage, sleep } from "../utils/browser.js";
import { invalidatePartsCache } from "../utils/recommend-helpers.js";
import { callGptInfo } from "../utils/gptInfo.js";
import { acquireLock, releaseLock, getRunning } from "../utils/syncLock.js";

const router = express.Router();

const DANAWA_PSU_URL = "https://prod.danawa.com/list/?cate=112777";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const isValidSpec = (s) =>
  typeof s === "string" &&
  (s.match(/\//g) || []).length >= 2 &&
  (/:\s/.test(s) || /^(AMD|NVIDIA|Intel)/i.test(s));

function extractPSUInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`.toUpperCase();
  const parts = [];

  const wattageMatch = combined.match(/(\d+)\s*W(?!\w)/i);
  if (wattageMatch) parts.push(`Wattage: ${wattageMatch[1]}W`);

  if (/80PLUS\s*TITANIUM|TITANIUM/i.test(combined)) parts.push("80Plus Titanium");
  else if (/80PLUS\s*PLATINUM|PLATINUM/i.test(combined)) parts.push("80Plus Platinum");
  else if (/80PLUS\s*GOLD|GOLD/i.test(combined)) parts.push("80Plus Gold");
  else if (/80PLUS\s*SILVER|SILVER/i.test(combined)) parts.push("80Plus Silver");
  else if (/80PLUS\s*BRONZE|BRONZE/i.test(combined)) parts.push("80Plus Bronze");
  else if (/80PLUS/i.test(combined)) parts.push("80Plus");

  if (/풀모듈러|FULL\s*MODULAR/i.test(combined)) parts.push("풀모듈러");
  else if (/세미모듈러|SEMI\s*MODULAR/i.test(combined)) parts.push("세미모듈러");
  else parts.push("논모듈러");

  if (/SFX-L/i.test(combined)) parts.push("SFX-L");
  else if (/SFX/i.test(combined)) parts.push("SFX");
  else if (/TFX/i.test(combined)) parts.push("TFX");
  else parts.push("ATX");

  return parts.join(", ");
}

async function crawlDanawaPSUs(maxPages = 10) {
  console.log(`🔍 다나와 PSU 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await setupPage(page, 60000);
    page.on('pageerror', (error) => console.log('⚠️ 페이지 에러:', error.message));
    page.on('requestfailed', (request) => console.log('⚠️ 요청 실패:', request.url(), request.failure()?.errorText));

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        if (pageNum === 1) {
          let retries = 5;
          let loaded = false;

          while (retries > 0 && !loaded) {
            try {
              await page.goto('about:blank');
              await sleep(2000);

              const navigateWithRetry = async (url) => {
                let attempts = 3;
                while (attempts--) {
                  try {
                    await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
                    await sleep(1000);
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await sleep(3000);
                    await page.waitForSelector('.main_prodlist, .product_list', { timeout: 20000 });
                    return true;
                  } catch (e) {
                    console.log('⚠️ 초기 네비게이션 실패:', e.message);
                    if (!attempts) throw e;
                  }
                }
              };

              await navigateWithRetry(DANAWA_PSU_URL);

              for (let i = 0; i < 5; i++) {
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                await sleep(400);
              }

              const hasContent = await page.waitForFunction(() => {
                return document.querySelectorAll('.main_prodlist .prod_item, .product_list .prod_item').length > 0;
              }, { timeout: 30000 });

              if (hasContent) {
                loaded = true;
                console.log('✅ 페이지 로딩 완료');
              } else {
                throw new Error('페이지 콘텐츠 로딩 실패');
              }
            } catch (e) {
              retries--;
              console.log(`⚠️ 로딩 재시도 (남은 횟수: ${retries}): ${e.message}`);
              if (retries === 0) throw e;
              await sleep(5000);
            }
          }

          await page.waitForSelector('.main_prodlist .prod_item', { timeout: 30000 }).catch(() => {});
          await sleep(3000);

        } else {
          try {
            await navigateToDanawaPage(page, pageNum, '.main_prodlist .prod_item');
          } catch (navError) {
            console.log(`❌ 페이지 ${pageNum} 이동 실패: ${navError.message}`);
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
              let image = '';
              const thumbLink = item.querySelector('.thumb_link') || item.querySelector('a.thumb_link');
              let imgEl = null;
              if (thumbLink) imgEl = thumbLink.querySelector('img') || thumbLink.querySelector('picture img');
              if (!imgEl) imgEl = item.querySelector('img') || item.querySelector('.thumb_image img') || item.querySelector('.prod_img img') || item.querySelector('picture img') || item.querySelector('.img_wrap img');
              if (imgEl) {
                const attrs = ['src','data-original','data-src','data-lazy-src','data-origin','data-url','data-img','data-image','data-lazy','data-srcset','data-original-src'];
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
              if (!image) {
                const bgEl = thumbLink || item.querySelector('.thumb_image') || item.querySelector('.prod_img');
                if (bgEl) {
                  const bgImage = window.getComputedStyle(bgEl).backgroundImage || bgEl.style.backgroundImage;
                  if (bgImage && bgImage !== 'none') { const m = bgImage.match(/url\(['"']?([^'"]+)['"']?\)/); if (m?.[1]) { image = m[1]; if (image.startsWith('//')) image = 'https:' + image; else if (image.startsWith('/')) image = 'https://img.danawa.com' + image; } }
                }
              }
              if (!image && nameEl) {
                const prodHref = nameEl.getAttribute('href') || '';
                const codeMatch = prodHref.match(/code=(\d+)/);
                if (codeMatch) { const prodCode = codeMatch[1]; const cp = prodCode.match(/(\d{2})(\d{2})(\d{2})/); if (cp) { const [_, a, b, c] = cp; image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`; } }
              }
              if (!image && thumbLink) {
                const href = thumbLink.getAttribute('href') || '';
                const codeMatch = href.match(/code=(\d+)/);
                if (codeMatch) { const prodCode = codeMatch[1]; const cp = prodCode.match(/(\d{2})(\d{2})(\d{2})/); if (cp) { const [_, a, b, c] = cp; image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`; } }
              }
              const specEl = item.querySelector('.spec_list');
              const spec = specEl?.textContent?.trim().replace(/\s+/g, ' ').replace(/더보기/g, '');
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;
              results.push({ name, image, spec: spec || '', price });
            } catch (e) {}
          });
          return results;
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개 수집`);
        if (pageProducts.length === 0) { console.log('⚠️ 페이지에서 제품을 찾지 못함'); break; }
        products.push(...pageProducts);
        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector('.nav_next');
          return nextBtn && !nextBtn.classList.contains('disabled');
        });
        if (!hasNext && pageNum < maxPages) { console.log(`⏹️ 마지막 페이지 도달 (페이지 ${pageNum})`); break; }
        await sleep(2000);
      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);
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

// 케이블, 어댑터 등 PSU 부속품 키워드 — 이름에 포함되면 실제 PSU가 아님
const ACCESSORY_PATTERN = /케이블|전선|슬리브|스플리터|어댑터|피팅|연장선|연장\s*케이블|변환\s*케이블|커넥터|connector|cable|splitter|adapter|sleeve|extension|PSU용|파워용/i;

// 와트 대비 가격이 비정상적으로 낮으면 부속품 의심 (40원/W 미만)
function hasSuspiciousWattPrice(name, price) {
  const m = name.match(/(\d{3,4})\s*W(?!\w)/i) || name.match(/\b(3[0-9]{2}|[4-9]\d{2}|[12]\d{3})\b/);
  if (!m) return false;
  const watts = parseInt(m[1]);
  if (watts < 300 || watts > 2500) return false;
  return price / watts < 40;
}

async function saveToMongoDB(psus, { ai = true, force = false } = {}) {
  if (psus.length === 0) { console.log("⛔ 크롤링 데이터 없음 — DB 삭제 건너뜀"); return; }
  const db = getDB();
  const col = db.collection("parts");

  const existing = await col.find({ category: "psu" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  // JS에서 필터링 후 $in으로 삭제 (MongoDB에 regex 직접 전달 시 PCRE2 /i + Unicode 오류 발생)
  const accessoryNames = existing.filter(d => ACCESSORY_PATTERN.test(d.name)).map(d => d.name);
  if (accessoryNames.length > 0) {
    const accessoryCleanup = await col.deleteMany({ category: "psu", name: { $in: accessoryNames } });
    if (accessoryCleanup.deletedCount > 0)
      console.log(`🧹 부속품 레코드 정리: ${accessoryCleanup.deletedCount}개 삭제`);
  }

  let inserted = 0, updated = 0, skipped = 0;

  for (const psu of psus) {
    if (!psu.price || psu.price === 0 || psu.price > 600000) {
      skipped++;
      console.log(`⏭️  건너뜀 (가격 이상: ${psu.price?.toLocaleString()}원): ${psu.name}`);
      continue;
    }
    if (ACCESSORY_PATTERN.test(psu.name)) {
      skipped++;
      console.log(`⏭  건너뜀 (부속품 키워드): ${psu.name}`);
      continue;
    }
    if (hasSuspiciousWattPrice(psu.name, psu.price)) {
      skipped++;
      console.log(`⏭  건너뜀 (와트 대비 가격 이상 — ${psu.price.toLocaleString()}원): ${psu.name}`);
      continue;
    }

    const old = byName.get(psu.name);
    const info = extractPSUInfo(psu.name, psu.spec);

    let review = old?.review || "";
    let specSummary = old?.specSummary || "";

    if (ai) {
      const needsAI = force || !old?.review || !isValidSpec(old?.specSummary);
      if (needsAI) {
        try {
          const aiRes = await callGptInfo(psu.name, "psu", "gpt-5.4-mini", OPENAI_API_KEY);
          if (aiRes.review) review = aiRes.review;
          if (aiRes.specSummary) specSummary = aiRes.specSummary;
        } catch (e) {
          console.error(`AI 생성 실패: ${psu.name} — ${e.message}`);
        }
      }
    }

    const update = {
      category: "psu", info, image: psu.image,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      updated++;
      console.log(`🔁 업데이트: ${psu.name} (가격: ${psu.price.toLocaleString()}원)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      await col.insertOne({ name: psu.name, ...update, price: psu.price, mallCount: 0, priceHistory: psu.price > 0 ? [{ date: today, price: psu.price }] : [] });
      inserted++;
      console.log(`🆕 삽입: ${psu.name} (가격: ${psu.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(400);
  }

  const currentNames = new Set(psus.map((p) => p.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length >= existing.length * 0.5) {
    console.log(`⚠️ 삭제 대상 ${toDelete.length}개 / 기존 ${existing.length}개 — 50% 초과로 삭제 취소 (부분 크롤링 의심)`);
  } else if (toDelete.length > 0) {
    await col.deleteMany({ category: "psu", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(`\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개`);
}

router.post("/sync-psu", async (req, res) => {
  if (!acquireLock("psu")) return res.status(409).json({ error: "SYNC_IN_PROGRESS", running: getRunning() });
  try {
    const maxPages = Number(req?.body?.pages) || 3;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({ message: `✅ 다나와 PSU 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)` });

    setImmediate(async () => {
      try {
        const psus = await crawlDanawaPSUs(maxPages);
        if (psus.length === 0) { console.log("⛔ 크롤링된 데이터 없음"); return; }
        await saveToMongoDB(psus, { ai, force });
        invalidatePartsCache();
        console.log("🎉 PSU 동기화 완료");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      } finally { releaseLock("psu"); }
    });
  } catch (err) {
    console.error("❌ sync-psu 실패", err);
    res.status(500).json({ error: "sync-psu 실패" });
  }
});

export async function runSync({ pages = 3, ai = true, force = false } = {}) {
  console.log("\n=== PSU 동기화 시작 ===");
  const psus = await crawlDanawaPSUs(pages);
  if (psus.length === 0) { console.log("⛔ 크롤링된 데이터 없음"); return; }
  await saveToMongoDB(psus, { ai, force });
  invalidatePartsCache();
  console.log("🎉 PSU 동기화 완료");
}
export default router;
