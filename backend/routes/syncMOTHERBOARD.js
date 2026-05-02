// routes/syncMOTHERBOARD.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser, setupPage, navigateToDanawaPage, sleep } from "../utils/browser.js";
import { invalidatePartsCache } from "../utils/recommend-helpers.js";
import { callGptInfo } from "../utils/gptInfo.js";
import { acquireLock, releaseLock, getRunning } from "../utils/syncLock.js";

const router = express.Router();

const DANAWA_BASE_URL = "https://prod.danawa.com/list/?cate=112751";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const isValidSpec = (s) =>
  typeof s === "string" &&
  (s.match(/\//g) || []).length >= 2 &&
  (/:\s/.test(s) || /^(AMD|NVIDIA|Intel)/i.test(s));

function extractSocketInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;

  if (/B850|X870|A850|B850E|X870E/i.test(combined)) return "Socket: AM5";
  if (/AM5|B650|X670|A620|B650E|X670E/i.test(combined)) return "Socket: AM5";
  if (/AM4|B550|X570|A520|B450|X470|B350|X370/i.test(combined)) return "Socket: AM4";
  if (/sTRX4|TRX40/i.test(combined)) return "Socket: sTRX4";
  if (/TR4|X399/i.test(combined)) return "Socket: TR4";
  if (/SP3|EPYC/i.test(combined)) return "Socket: SP3";
  if (/Z890|B860|H870|LGA\s?1851/i.test(combined)) return "Socket: LGA1851";
  if (/Z790|B760|H770|Z690|B660|H610|H670|LGA\s?1700/i.test(combined)) return "Socket: LGA1700";
  if (/Z590|B560|H570|Z490|B460|H410|LGA\s?1200/i.test(combined)) return "Socket: LGA1200";
  if (/Z390|B360|H370|Z370|B250|H270|Z270|B150|H170|Z170|LGA\s?1151/i.test(combined)) return "Socket: LGA1151";
  if (/X299|LGA\s?2066/i.test(combined)) return "Socket: LGA2066";
  if (/X99|LGA\s?2011[-\s]?(?:3|V3)/i.test(combined)) return "Socket: LGA2011-3";
  if (/X79|LGA\s?2011/i.test(combined)) return "Socket: LGA2011";
  if (/X58|LGA\s?1366/i.test(combined)) return "Socket: LGA1366";
  if (/Z97|H97|Z87|H87|B85|H81|LGA\s?1150/i.test(combined)) return "Socket: LGA1150";
  if (/Z77|H77|Z68|P67|H67|B75|LGA\s?1155/i.test(combined)) return "Socket: LGA1155";
  if (/P45|P35|G41|LGA\s?775/i.test(combined)) return "Socket: LGA775";
  if (/LGA\s?3647|Xeon/i.test(combined)) return "Socket: LGA3647";
  if (/LGA\s?4677/i.test(combined)) return "Socket: LGA4677";
  if (/LGA\s?4189/i.test(combined)) return "Socket: LGA4189";

  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `Socket: LGA${lga[1]}`;

  return "";
}

async function crawlDanawaMotherboards(maxPages = 10) {
  console.log(`\uD83D\uDD0D \ub2e4\ub098\uc640 \uba54\uc778\ubcf4\ub4dc \ud06c\ub864\ub9c1 \uc2dc\uc791 (\ucd5c\ub300 ${maxPages}\ud398\uc774\uc9c0)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await setupPage(page, 60000);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\uD83D\uDCC4 \ud398\uc774\uc9c0 ${pageNum}/${maxPages} \ucc98\ub9ac \uc911...`);

      try {
        if (pageNum === 1) {
          let retries = 3;
          let loaded = false;
          while (retries > 0 && !loaded) {
            try {
              await page.goto(DANAWA_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
              loaded = true;
            } catch (e) {
              retries--;
              if (retries === 0) throw e;
              await sleep(2000);
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

const KNOWN_CHIPSETS = /a320|a520|a620|b350|b450|b550|b650|b850|x370|x470|x570|x670|x870|h81|h97|h110|h170|h270|h310|h370|h410|h470|h510|h610|h810|b150|b250|b360|b365|b460|b560|b660|b760|b840|b860|z170|z270|z370|z390|z490|z590|z690|z790|z890|trx|wrx|w790|w880|w680|w790e|x299|x13s|c621/i;

async function saveToMongoDB(motherboards, { ai = true, force = false } = {}) {
  if (motherboards.length === 0) { console.log("\u26d4 \ud06c\ub864\ub9c1 \ub370\uc774\ud130 \uc5c6\uc74c \u2014 DB \uc0ad\uc81c \uac74\ub108\ub700"); return; }
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "motherboard" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  // \uc54c\ub824\uc9c4 \uce69\uc14b \ud328\ud134 \uc5c6\ub294 \ud488\ubaa9(\uc544\ub450\uc774\ub178, \ub77c\uc988\ubca0\ub9ac\ud30c\uc774 \ub4f1) \ud544\ud130\ub9c1
  const filtered = motherboards.filter((b) => KNOWN_CHIPSETS.test(b.name));
  const removed = motherboards.length - filtered.length;
  if (removed > 0) console.log(`\ud83e\uddf9 \ube44\uba54\uc778\ubcf4\ub4dc \ud488\ubaa9 ${removed}\uac1c \uc81c\uc678`);
  motherboards = filtered;

  let inserted = 0, updated = 0, skipped = 0;

  for (const board of motherboards) {
    if (!board.price || board.price === 0 || board.price > 2000000) {
      skipped++;
      console.log(`\u23ED\uFE0F  \uac74\ub108\ub700 (\uac00\uaca9 \uc774\uc0c1: ${board.price?.toLocaleString()}\uc6d0): ${board.name}`);
      continue;
    }

    const old = byName.get(board.name);
    const info = extractSocketInfo(board.name, board.spec);

    let review = old?.review || "";
    let specSummary = old?.specSummary || "";

    if (ai) {
      const needsAI = force || !old?.review || !isValidSpec(old?.specSummary);
      if (needsAI) {
        try {
          const aiRes = await callGptInfo(board.name, "motherboard", "gpt-5.4-mini", OPENAI_API_KEY);
          if (aiRes.review) review = aiRes.review;
          if (aiRes.specSummary) specSummary = aiRes.specSummary;
        } catch (e) {
          console.error(`AI \uC0DD\uC131 \uC2E4\uD328: ${board.name} \u2014 ${e.message}`);
        }
      }
    }

    const update = {
      category: "motherboard", info, image: board.image,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      updated++;
      console.log(`\uD83D\uDD01 \uc5c5\ub370\uc774\ud2b8: ${board.name} (\uac00\uaca9: ${board.price.toLocaleString()}\uc6d0)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      await col.insertOne({ name: board.name, ...update, price: board.price, mallCount: 0, priceHistory: board.price > 0 ? [{ date: today, price: board.price }] : [] });
      inserted++;
      console.log(`\uD83C\uDD95 \uc0bd\uc785: ${board.name} (\uac00\uaca9: ${board.price.toLocaleString()}\uc6d0)`);
    }

    if (ai) await sleep(400);
  }

  const currentNames = new Set(motherboards.map((b) => b.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length >= existing.length * 0.5) {
    console.log(`\u26a0\uFE0F \uc0ad\uc81c \ub300\uc0c1 ${toDelete.length}\uac1c / \uae30\uc874 ${existing.length}\uac1c \u2014 50% \ucd08\uacfc\ub85c \uc0ad\uc81c \ucde8\uc18c (\ubd80\ubd84 \ud06c\ub864\ub9c1 \uc758\uc2ec)`);
  } else if (toDelete.length > 0) {
    await col.deleteMany({ category: "motherboard", name: { $in: toDelete } });
    console.log(`\uD83D\uDDD1\uFE0F \uc0ad\uc81c\ub428: ${toDelete.length}\uac1c`);
  }

  console.log(`\n\uD83D\uDCC8 \ucd5c\uc885 \uacb0\uacfc: \uc0bd\uc785 ${inserted}\uac1c, \uc5c5\ub370\uc774\ud2b8 ${updated}\uac1c, \uc0ad\uc81c ${toDelete.length}\uac1c, \uac74\ub108\ub700 ${skipped}\uac1c`);
}

router.post("/sync-motherboards", async (req, res) => {
  if (!acquireLock("motherboard")) return res.status(409).json({ error: "SYNC_IN_PROGRESS", running: getRunning() });
  try {
    const maxPages = Number(req?.body?.pages) || 3;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({ message: `\u2705 \ub2e4\ub098\uc640 \uba54\uc778\ubcf4\ub4dc \ub3d9\uae30\ud654 \uc2dc\uc791 (pages=${maxPages}, ai=${ai}, \uac00\uaca9 \ud3ec\ud568)` });

    setImmediate(async () => {
      try {
        const motherboards = await crawlDanawaMotherboards(maxPages);
        if (motherboards.length === 0) { console.log("\u26D4 \ud06c\ub864\ub9c1\ub41c \ub370\uc774\ud130 \uc5c6\uc74c"); return; }
        await saveToMongoDB(motherboards, { ai, force });
        invalidatePartsCache();
        console.log("\uD83C\uDF89 \uba54\uc778\ubcf4\ub4dc \ub3d9\uae30\ud654 \uc644\ub8cc");
      } catch (err) {
        console.error("\u274C \ub3d9\uae30\ud654 \uc2e4\ud328:", err);
      } finally { releaseLock("motherboard"); }
    });
  } catch (err) {
    console.error("\u274C sync-motherboards \uc2e4\ud328", err);
    res.status(500).json({ error: "sync-motherboards \uc2e4\ud328" });
  }
});

export async function runSync({ pages = 3, ai = true, force = false } = {}) {
  console.log("\n=== 메인보드 동기화 시작 ===");
  const motherboards = await crawlDanawaMotherboards(pages);
  if (motherboards.length === 0) { console.log("⛔ 크롤링된 데이터 없음"); return; }
  await saveToMongoDB(motherboards, { ai, force });
  invalidatePartsCache();
  console.log("🎉 메인보드 동기화 완료");
}
export default router;
