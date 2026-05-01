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

  if (/\ud480\ubaa8\ub4c8\ub7ec|FULL\s*MODULAR/i.test(combined)) parts.push("\ud480\ubaa8\ub4c8\ub7ec");
  else if (/\uc138\ubbf8\ubaa8\ub4c8\ub7ec|SEMI\s*MODULAR/i.test(combined)) parts.push("\uc138\ubbf8\ubaa8\ub4c8\ub7ec");
  else parts.push("\ub17c\ubaa8\ub4c8\ub7ec");

  if (/SFX-L/i.test(combined)) parts.push("SFX-L");
  else if (/SFX/i.test(combined)) parts.push("SFX");
  else if (/TFX/i.test(combined)) parts.push("TFX");
  else parts.push("ATX");

  return parts.join(", ");
}

async function crawlDanawaPSUs(maxPages = 10) {
  console.log(`\uD83D\uDD0D \ub2e4\ub098\uc640 PSU \ud06c\ub864\ub9c1 \uc2dc\uc791 (\ucd5c\ub300 ${maxPages}\ud398\uc774\uc9c0)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await setupPage(page, 60000);
    page.on('pageerror', (error) => console.log('\u26A0\uFE0F \ud398\uc774\uc9c0 \uc5d0\ub7ec:', error.message));
    page.on('requestfailed', (request) => console.log('\u26A0\uFE0F \uc694\uccad \uc2e4\ud328:', request.url(), request.failure()?.errorText));

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\uD83D\uDCC4 \ud398\uc774\uc9c0 ${pageNum}/${maxPages} \ucc98\ub9ac \uc911...`);

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
                    console.log('\u26A0\uFE0F \ucd08\uae30 \ub124\ube44\uac8c\uc774\uc158 \uc2e4\ud328:', e.message);
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
                console.log('\u2705 \ud398\uc774\uc9c0 \ub85c\ub529 \uc644\ub8cc');
              } else {
                throw new Error('\ud398\uc774\uc9c0 \ucf58\ud150\uce20 \ub85c\ub529 \uc2e4\ud328');
              }
            } catch (e) {
              retries--;
              console.log(`\u26A0\uFE0F \ub85c\ub529 \uc7ac\uc2dc\ub3c4 (\ub0a8\uc740 \ud69f\uc218: ${retries}): ${e.message}`);
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
            console.log(`\u274C \ud398\uc774\uc9c0 ${pageNum} \uc774\ub3d9 \uc2e4\ud328: ${navError.message}`);
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
              const spec = specEl?.textContent?.trim().replace(/\s+/g, ' ').replace(/\ub354\ubcf4\uae30/g, '');
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;
              results.push({ name, image, spec: spec || '', price });
            } catch (e) {}
          });
          return results;
        });

        console.log(`\u2705 \ud398\uc774\uc9c0 ${pageNum}: ${pageProducts.length}\uac1c \uc218\uc9d1`);
        if (pageProducts.length === 0) { console.log('\u26A0\uFE0F \ud398\uc774\uc9c0\uc5d0\uc11c \uc81c\ud488\uc744 \ucc3e\uc9c0 \ubabb\ud568'); break; }
        products.push(...pageProducts);
        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector('.nav_next');
          return nextBtn && !nextBtn.classList.contains('disabled');
        });
        if (!hasNext && pageNum < maxPages) { console.log(`\u23F9\uFE0F \ub9c8\uc9c0\ub9c9 \ud398\uc774\uc9c0 \ub3c4\ub2ec (\ud398\uc774\uc9c0 ${pageNum})`); break; }
        await sleep(2000);
      } catch (e) {
        console.error(`\u274C \ud398\uc774\uc9c0 ${pageNum} \ucc98\ub9ac \uc2e4\ud328:`, e.message);
        if (pageNum === 1) break;
      }
    }
  } catch (error) {
    console.error("\u274C \ud06c\ub864\ub9c1 \uc2e4\ud328:", error.message);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\uD83C\uDF89 \ucd1d ${products.length}\uac1c \uc81c\ud488 \uc218\uc9d1 \uc644\ub8cc`);
  return products;
}

// \ucf00\uc774\ube14, \uc5b4\ub311\ud130 \ub4f1 PSU \ubd80\uc18d\ud488 \ud0a4\uc6cc\ub4dc \u2014 \uc774\ub984\uc5d0 \ud3ec\ud568\ub418\uba74 \uc2e4\uc81c PSU\uac00 \uc544\ub2d8
const ACCESSORY_PATTERN = /\ucf00\uc774\ube14|\uc804\uc120|\uc2ac\ub9ac\ube0c|\uc2a4\ud50c\ub9ac\ud130|\uc5b4\ub311\ud130|\ud53c\ud305|\uc5f0\uc7a5\uc120|\uc5f0\uc7a5\s*\ucf00\uc774\ube14|\ubcc0\ud658\s*\ucf00\uc774\ube14|\ucee4\ub125\ud130|connector|cable|splitter|adapter|sleeve|extension|PSU\uc6a9|\ud30c\uc6cc\uc6a9/i;

// \uc640\ud2b8 \ub300\ube44 \uac00\uaca9\uc774 \ube44\uc815\uc0c1\uc801\uc73c\ub85c \ub0ae\uc73c\uba74 \ubd80\uc18d\ud488 \uc758\uc2ec (40\uc6d0/W \ubbf8\ub9cc)
function hasSuspiciousWattPrice(name, price) {
  const m = name.match(/(\d{3,4})\s*W(?!\w)/i) || name.match(/\b(3[0-9]{2}|[4-9]\d{2}|[12]\d{3})\b/);
  if (!m) return false;
  const watts = parseInt(m[1]);
  if (watts < 300 || watts > 2500) return false;
  return price / watts < 40;
}

async function saveToMongoDB(psus, { ai = true, force = false } = {}) {
  if (psus.length === 0) { console.log("\u26d4 \ud06c\ub864\ub9c1 \ub370\uc774\ud130 \uc5c6\uc74c \u2014 DB \uc0ad\uc81c \uac74\ub108\ub700"); return; }
  const db = getDB();
  const col = db.collection("parts");

  // \uae30\uc874 DB\uc5d0\uc11c \ubd80\uc18d\ud488\uc73c\ub85c \uc798\ubabb \ub4e4\uc5b4\uac04 \ub808\ucf54\ub4dc \uc989\uc2dc \uc0ad\uc81c
  const accessoryCleanup = await col.deleteMany({ category: "psu", name: ACCESSORY_PATTERN });
  if (accessoryCleanup.deletedCount > 0)
    console.log(`\ud83e\uddf9 \ubd80\uc18d\ud488 \ub808\ucf54\ub4dc \uc815\ub9ac: ${accessoryCleanup.deletedCount}\uac1c \uc0ad\uc81c`);

  const existing = await col.find({ category: "psu" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const psu of psus) {
    if (!psu.price || psu.price === 0 || psu.price > 600000) {
      skipped++;
      console.log(`\u23ED\uFE0F  \uac74\ub108\ub700 (\uac00\uaca9 \uc774\uc0c1: ${psu.price?.toLocaleString()}\uc6d0): ${psu.name}`);
      continue;
    }
    if (ACCESSORY_PATTERN.test(psu.name)) {
      skipped++;
      console.log(`\u23ED  \uac74\ub108\ub700 (\ubd80\uc18d\ud488 \ud0a4\uc6cc\ub4dc): ${psu.name}`);
      continue;
    }
    if (hasSuspiciousWattPrice(psu.name, psu.price)) {
      skipped++;
      console.log(`\u23ED  \uac74\ub108\ub700 (\uc640\ud2b8 \ub300\ube44 \uac00\uaca9 \uc774\uc0c1 \u2014 ${psu.price.toLocaleString()}\uc6d0): ${psu.name}`);
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
          console.error(`AI \uC0DD\uC131 \uC2E4\uD328: ${psu.name} \u2014 ${e.message}`);
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
      console.log(`\uD83D\uDD01 \uc5c5\ub370\uc774\ud2b8: ${psu.name} (\uac00\uaca9: ${psu.price.toLocaleString()}\uc6d0)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      await col.insertOne({ name: psu.name, ...update, price: psu.price, mallCount: 0, priceHistory: psu.price > 0 ? [{ date: today, price: psu.price }] : [] });
      inserted++;
      console.log(`\uD83C\uDD95 \uc0bd\uc785: ${psu.name} (\uac00\uaca9: ${psu.price.toLocaleString()}\uc6d0)`);
    }

    if (ai) await sleep(400);
  }

  const currentNames = new Set(psus.map((p) => p.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length >= existing.length * 0.5) {
    console.log(`\u26a0\uFE0F \uc0ad\uc81c \ub300\uc0c1 ${toDelete.length}\uac1c / \uae30\uc874 ${existing.length}\uac1c \u2014 50% \ucd08\uacfc\ub85c \uc0ad\uc81c \ucde8\uc18c (\ubd80\ubd84 \ud06c\ub864\ub9c1 \uc758\uc2ec)`);
  } else if (toDelete.length > 0) {
    await col.deleteMany({ category: "psu", name: { $in: toDelete } });
    console.log(`\uD83D\uDDD1\uFE0F \uc0ad\uc81c\ub428: ${toDelete.length}\uac1c`);
  }

  console.log(`\n\uD83D\uDCC8 \ucd5c\uc885 \uacb0\uacfc: \uc0bd\uc785 ${inserted}\uac1c, \uc5c5\ub370\uc774\ud2b8 ${updated}\uac1c, \uc0ad\uc81c ${toDelete.length}\uac1c, \uac74\ub108\ub700 ${skipped}\uac1c`);
}

router.post("/sync-psu", async (req, res) => {
  if (!acquireLock("psu")) return res.status(409).json({ error: "SYNC_IN_PROGRESS", running: getRunning() });
  try {
    const maxPages = Number(req?.body?.pages) || 3;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({ message: `\u2705 \ub2e4\ub098\uc640 PSU \ub3d9\uae30\ud654 \uc2dc\uc791 (pages=${maxPages}, ai=${ai}, \uac00\uaca9 \ud3ec\ud568)` });

    setImmediate(async () => {
      try {
        const psus = await crawlDanawaPSUs(maxPages);
        if (psus.length === 0) { console.log("\u26D4 \ud06c\ub864\ub9c1\ub41c \ub370\uc774\ud130 \uc5c6\uc74c"); return; }
        await saveToMongoDB(psus, { ai, force });
        invalidatePartsCache();
        console.log("\uD83C\uDF89 PSU \ub3d9\uae30\ud654 \uc644\ub8cc");
      } catch (err) {
        console.error("\u274C \ub3d9\uae30\ud654 \uc2e4\ud328:", err);
      } finally { releaseLock("psu"); }
    });
  } catch (err) {
    console.error("\u274C sync-psu \uc2e4\ud328", err);
    res.status(500).json({ error: "sync-psu \uc2e4\ud328" });
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
