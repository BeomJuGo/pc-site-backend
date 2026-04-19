// routes/syncPSU.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();

const DANAWA_PSU_URL = "https://prod.danawa.com/list/?cate=112777";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("\u26A0\uFE0F OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `파워서플라이 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<출력/효율/모듈러/폼팩터>"}`;

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
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
  console.log(`\uD83D\uDD0D 다나와 PSU 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setDefaultTimeout(60000);
    await page.setDefaultNavigationTimeout(60000);
    await page.emulateTimezone('Asia/Seoul');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const blockHosts = [
      'google-analytics.com','analytics.google.com','googletagmanager.com','google.com/ccm',
      'ad.danawa.com','dsas.danawa.com','service-api.flarelane.com','doubleclick.net',
      'adnxs.com','googlesyndication.com','scorecardresearch.com','facebook.net'
    ];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const type = req.resourceType();
      if (blockHosts.some(h => url.includes(h))) return req.abort();
      if (type === 'media' || type === 'font') return req.abort();
      return req.continue();
    });

    page.on('pageerror', (error) => console.log('\u26A0\uFE0F 페이지 에러:', error.message));
    page.on('requestfailed', (request) => console.log('\u26A0\uFE0F 요청 실패:', request.url(), request.failure()?.errorText));

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\uD83D\uDCC4 페이지 ${pageNum}/${maxPages} 처리 중...`);

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
                    console.log('\u26A0\uFE0F 초기 네비게이션 실패:', e.message);
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
                console.log('\u2705 페이지 로딩 완료');
              } else {
                throw new Error('페이지 콘텐츠 로딩 실패');
              }
            } catch (e) {
              retries--;
              console.log(`\u26A0\uFE0F 로딩 재시도 (남은 횟수: ${retries}): ${e.message}`);
              if (retries === 0) throw e;
              await sleep(5000);
            }
          }

          await page.waitForSelector('.main_prodlist .prod_item', { timeout: 30000 }).catch(() => {});
          await sleep(3000);

        } else {
          try {
            const pageSelector = `a.num[page="${pageNum}"]`;
            const pageExists = await page.evaluate((selector) => document.querySelector(selector) !== null, pageSelector);

            if (pageExists) {
              await page.click(pageSelector);
              await sleep(5000);
              await page.waitForFunction(() => document.querySelectorAll('.main_prodlist .prod_item').length > 0, { timeout: 30000 });
            } else {
              await page.evaluate((p) => {
                if (typeof movePage === "function") movePage(p);
                else if (typeof goPage === "function") goPage(p);
                else if (typeof changePage === "function") changePage(p);
                else {
                  const pageBtn = document.querySelector(`a.num[page="${p}"]`);
                  if (pageBtn) { pageBtn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true })); }
                  else throw new Error('페이지 이동 실패');
                }
              }, pageNum);
              await sleep(5000);
              await page.waitForFunction(() => document.querySelectorAll('.main_prodlist .prod_item').length > 0, { timeout: 30000 });
            }
          } catch (navError) {
            console.log(`\u274C 페이지 ${pageNum} 이동 실패: ${navError.message}`);
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
                  if (bgImage && bgImage !== 'none') { const m = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/); if (m?.[1]) { image = m[1]; if (image.startsWith('//')) image = 'https:' + image; else if (image.startsWith('/')) image = 'https://img.danawa.com' + image; } }
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

        console.log(`\u2705 페이지 ${pageNum}: ${pageProducts.length}개 수집`);
        if (pageProducts.length === 0) { console.log('\u26A0\uFE0F 페이지에서 제품을 찾지 못함'); break; }

        products.push(...pageProducts);

        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector('.nav_next');
          return nextBtn && !nextBtn.classList.contains('disabled');
        });
        if (!hasNext && pageNum < maxPages) { console.log(`\u23F9\uFE0F 마지막 페이지 도달 (페이지 ${pageNum})`); break; }

        await sleep(2000);
      } catch (e) {
        console.error(`\u274C 페이지 ${pageNum} 처리 실패:`, e.message);
        if (pageNum === 1) break;
      }
    }
  } catch (error) {
    console.error("\u274C 크롤링 실패:", error.message);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\uD83C\uDF89 총 ${products.length}개 제품 수집 완료`);
  return products;
}

async function saveToMongoDB(psus, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "psu" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const psu of psus) {
    if (!psu.price || psu.price === 0) {
      skipped++;
      console.log(`\u23ED\uFE0F  건너뜀 (가격 0원): ${psu.name}`);
      continue;
    }

    const old = byName.get(psu.name);
    const info = extractPSUInfo(psu.name, psu.spec);

    let review = "", specSummary = "";
    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({ name: psu.name, spec: psu.spec });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "psu", info, image: psu.image, price: psu.price || 0,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };
      if (psu.price > 0 && psu.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { date: today, price: psu.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`\uD83D\uDD01 업데이트: ${psu.name} (가격: ${psu.price.toLocaleString()}원)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const priceHistory = psu.price > 0 ? [{ date: today, price: psu.price }] : [];
      await col.insertOne({ name: psu.name, ...update, priceHistory });
      inserted++;
      console.log(`\uD83C\uDD95 삽입: ${psu.name} (가격: ${psu.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(psus.map((p) => p.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "psu", name: { $in: toDelete } });
    console.log(`\uD83D\uDDD1\uFE0F 삭제됨: ${toDelete.length}개`);
  }

  console.log(`\n\uD83D\uDCC8 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개`);
}

router.post("/sync-psu", async (req, res) => {
  try {
    const maxPages = Number(req?.body?.pages) || 3;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({ message: `\u2705 다나와 PSU 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)` });

    setImmediate(async () => {
      try {
        const psus = await crawlDanawaPSUs(maxPages);
        if (psus.length === 0) { console.log("\u26D4 크롤링된 데이터 없음"); return; }
        await saveToMongoDB(psus, { ai, force });
        console.log("\uD83C\uDF89 PSU 동기화 완료");
      } catch (err) {
        console.error("\u274C 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("\u274C sync-psu 실패", err);
    res.status(500).json({ error: "sync-psu 실패" });
  }
});

export default router;
