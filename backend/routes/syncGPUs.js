// routes/syncGPUs.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";
import { launchBrowser, setupPage, navigateToDanawaPage, sleep } from "../utils/browser.js";
import { acquireLock, releaseLock, getRunning } from "../utils/syncLock.js";
import { invalidatePartsCache } from "../utils/recommend-helpers.js";
import { callGptInfo } from "../utils/gptInfo.js";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DANAWA_GPU_URL = "https://prod.danawa.com/list/?cate=112753";
const NAV_TIMEOUT = Number(process.env.PUPPETEER_NAV_TIMEOUT || 150000);
const MIN_3DMARK_SCORE_TO_ATTACH = 6000;

const simplifyForFilter = (name) => {
  return name
    .replace(/NVIDIA GeForce |AMD Radeon /gi, "")
    .replace(/\b(TI|XT|SUPER|PRO|Ultra|GA\d+)\b/gi, " $1")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
};

const isValidGPUName = (name) => {
  const upper = name.toUpperCase();
  return /(RTX|RX)\s*\d{3,5}/i.test(upper);
};

const normalizeGpuKey = (rawName = "") => {
  const n = rawName
    .toUpperCase()
    .replace(/NVIDIA GEFORCE|GEFORCE|NVIDIA|AMD RADEON|RADEON/g, "")
    .replace(/LAPTOP|MOBILE|NOTEBOOK|DESKTOP|OEM|FOUNDERS|EDITION|GDDR\d|PCI-?E|PCIE|LP|LPX|MINI|ITX|OC|DUAL|TRIPLE|TURBO|VENTUS|EAGLE|GAMING|TUF|ROG|MECH|WINDFORCE|HELLHOUND|PULSE|RED DEVIL|FIGHTER|JETSTREAM|PHOENIX|AERO|VENTURA|SPECTRIX|MERC|STEEL LEGEND|PGD/g, "")
    .replace(/\b(\d+\s?GB)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const series = /(RTX|RX)/.exec(n)?.[1] || "";
  const model = /\b(\d{3,5})\b/.exec(n)?.[1] || "";
  const hasTi = /\bTI\b/.test(n);
  const hasSuper = /\bSUPER\b/.test(n);
  const hasXt = /\bXT\b/.test(n);
  const hasXtx = /\bXTX\b/.test(n);
  const hasGre = /\bGRE\b/.test(n);

  if (!series || !model) return "";

  const parts = [series, model];
  if (series === "RTX") {
    if (hasTi) parts.push("TI");
    if (hasSuper) parts.push("SUPER");
  } else if (series === "RX") {
    if (hasXtx) parts.push("XTX");
    else if (hasXt) parts.push("XT");
    if (hasGre) parts.push("GRE");
  }

  return parts.join(" ").trim();
};

const isUnwantedGPU = (name) =>
  /rtx\s*4500|radeon\s*pro|ada generation|titan|\bD$/i.test(name);

async function fetchGPUs() {
  const url = "https://www.topcpu.net/ko/gpu-r/3dmark-time-spy-desktop";
  const html = await axios.get(url).then((res) => res.data);
  const $ = cheerio.load(html);
  const gpuList = [];
  const nameSet = new Set();

  const isValidTimeSpyScore = (num) => num >= 2000 && num <= 60000;

  $("div.flex.flex-col, li, tr, .flex.flex-row").each((_, el) => {
    const name = (
      $(el).find("a").first().text() ||
      $(el).find("strong").first().text() ||
      ""
    ).trim();

    if (!name) return;

    let score = 0;
    const scoreText = $(el).find('span.font-bold').first().text().replace(/,/g, '').trim();
    const parsed = parseInt(scoreText, 10);
    if (!isNaN(parsed) && isValidTimeSpyScore(parsed)) {
      score = parsed;
    }

    const simplified = simplifyForFilter(name);

    if (!name || !score) return;
    if (!isValidTimeSpyScore(score)) return;
    if (!isValidGPUName(simplified))
      return console.log("\u26d4 \uc81c\uc678 (\ud615\uc2dd \ubd88\uc77c\uce58):", name);
    if (isUnwantedGPU(name))
      return console.log("\u26d4 \uc81c\uc678 (\ube44\uc8fc\ub958):", name);

    const base = simplified.toLowerCase();
    if (nameSet.has(base))
      return console.log("\u26d4 \uc81c\uc678 (\uc911\ubcf5):", name);
    nameSet.add(base);

    console.log(`\u2705 GPU \ud06c\ub864\ub9c1: "${name}" \u2192 \uc810\uc218: ${score}`);
    gpuList.push({ name, score, key: normalizeGpuKey(name) });
  });

  console.log("\u2705 \ud06c\ub864\ub9c1 \uc644\ub8cc, \uc720\ud6a8 GPU \uc218:", gpuList.length);
  return gpuList;
}

async function crawlDanawaGpus(maxPages = 10) {
  console.log(`\uD83D\uDD0D \ub2e4\ub098\uc640 GPU \ud06c\ub864\ub9c1 \uc2dc\uc791 (\ucd5c\ub300 ${maxPages}\ud398\uc774\uc9c0)`);

  let browser;
  const products = [];

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await setupPage(page, NAV_TIMEOUT);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\uD83D\uDCC4 \ud398\uc774\uc9c0 ${pageNum}/${maxPages} \ucc98\ub9ac \uc911...`);

      try {
        if (pageNum === 1) {
          let retries = 3;
          let loaded = false;
          while (retries > 0 && !loaded) {
            try {
              await page.goto(DANAWA_GPU_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
              loaded = true;
              console.log('\u2705 \ud398\uc774\uc9c0 \ub85c\ub529 \uc644\ub8cc');
            } catch (e) {
              retries--;
              console.log(`\u26A0\uFE0F \ub85c\ub529 \uc7ac\uc2dc\ub3c4 (\ub0a8\uc740 \ud69f\uc218: ${retries})`);
              if (retries === 0) throw e;
              await sleep(2000);
            }
          }

          await page.waitForSelector('.main_prodlist .prod_item', { timeout: NAV_TIMEOUT / 3 }).catch(() => {
            console.log('\u26A0\uFE0F \uc81c\ud488 \ub9ac\uc2a4\ud2b8 \ub85c\ub529 \uc9c0\uc5f0');
          });

          await page.evaluate(() => {
            const lazyImages = document.querySelectorAll('img[data-original], img[data-src], img[data-lazy-src]');
            lazyImages.forEach(img => {
              const src = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
              if (src) img.src = src;
            });
          });

          await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight / 2); });
          await sleep(3000);
          await page.evaluate(() => { window.scrollTo(0, 0); });
          await sleep(2000);

          await page.evaluate(async () => {
            const images = Array.from(document.querySelectorAll('img'));
            await Promise.all(images.map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 500);
              });
            }));
          });
        } else {
          try {
            await navigateToDanawaPage(page, pageNum, '.main_prodlist .prod_item');
          } catch (e) {
            console.log(`\u26A0\uFE0F \ud398\uc774\uc9c0 ${pageNum} \uc774\ub3d9 \uc2e4\ud328: ${e.message}`);
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
                  if (bgImage && bgImage !== 'none') {
                    const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                    if (urlMatch?.[1]) { image = urlMatch[1]; if (image.startsWith('//')) image = 'https:' + image; else if (image.startsWith('/')) image = 'https://img.danawa.com' + image; }
                  }
                }
              }
              if (!image && thumbLink) {
                const href = thumbLink.getAttribute('href') || '';
                const codeMatch = href.match(/code=(\d+)/);
                if (codeMatch) { const prodCode = codeMatch[1]; const codeParts = prodCode.match(/(\d{2})(\d{2})(\d{2})/); if (codeParts) { const [_, a, b, c] = codeParts; image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`; } }
              }
              if (!image && nameEl) {
                const prodHref = nameEl.getAttribute('href') || '';
                const codeMatch = prodHref.match(/code=(\d+)/);
                if (codeMatch) { const prodCode = codeMatch[1]; const codeParts = prodCode.match(/(\d{2})(\d{2})(\d{2})/); if (codeParts) { const [_, a, b, c] = codeParts; image = `https://img.danawa.com/prod_img/500000/${a}${b}${c}/img/${prodCode}_1.jpg?shrink=130:130`; } }
              }
              const specEl = item.querySelector('.spec_list');
              const spec = specEl?.textContent?.trim().replace(/\s+/g, ' ').replace(/\ub354\ubcf4\uae30/g, '') || '';
              const priceEl = item.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) { price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0; }
              results.push({ name, image, spec, price });
            } catch (_) {}
          });
          return results;
        });

        console.log(`\u2705 \ud398\uc774\uc9c0 ${pageNum}: ${pageProducts.length}\uac1c \uc218\uc9d1`);
        if (pageProducts.length === 0) break;
        products.push(...pageProducts);
        await sleep(2000);
      } catch (e) {
        console.log(`\u274C \ud398\uc774\uc9c0 ${pageNum} \ucc98\ub9ac \uc2e4\ud328: ${e.message}`);
        if (pageNum === 1) break;
      }
    }
  } catch (error) {
    console.error("\u274C GPU \ud06c\ub864\ub9c1 \uc2e4\ud328:", error.message);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\uD83C\uDF89 \ucd1d ${products.length}\uac1c GPU \uc81c\ud488 \uc218\uc9d1 \uc644\ub8cc`);
  return products;
}

const extractManufacturer = (name = "") => {
  const n = name.toUpperCase();
  if (n.includes("NVIDIA") || n.includes("\uc9c0\ud3ec\uc2a4") || n.includes("GEFORCE") || n.includes("RTX") || n.includes("GTX")) return "NVIDIA";
  if (n.includes("AMD") || n.includes("RADEON") || n.includes("\ub77c\ub370\uc628") || /RX\s*\d+/.test(n)) return "AMD";
  return "";
};

const isValidSpec = (s) =>
  typeof s === "string" &&
  (s.match(/\//g) || []).length >= 2 &&
  (/:\s/.test(s) || /^(AMD|NVIDIA|Intel)/i.test(s));

async function saveToDB(gpus, danawaProducts, options = {}) {
  const { ai = true, force = false } = options;
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "gpu" }).toArray();
  const currentNames = new Set(danawaProducts.map((g) => g.name));

  const scoreByKey = new Map();
  for (const g of gpus) {
    const key = g.key || normalizeGpuKey(g.name);
    if (!key) continue;
    const prev = scoreByKey.get(key) || 0;
    if (g.score > prev) scoreByKey.set(key, g.score);
  }

  for (const p of danawaProducts) {
    if (!p.price || p.price === 0) {
      console.log(`\u23ED\uFE0F  \uac74\ub108\ub700 (\uac00\uaca9 0\uc6d0): ${p.name}`);
      continue;
    }

    const old = existing.find((e) => e.name === p.name);
    const key = normalizeGpuKey(p.name);
    const score = key ? (scoreByKey.get(key) || 0) : 0;

    let review = old?.review || "";
    let specSummary = old?.specSummary || p.spec || "";

    if (ai) {
      const needsAI = force || !old?.review || !isValidSpec(old?.specSummary);
      if (needsAI) {
        try {
          const aiRes = await callGptInfo(p.name, "gpu", "gpt-5.4", OPENAI_API_KEY);
          if (aiRes.review) review = aiRes.review;
          if (aiRes.specSummary) specSummary = aiRes.specSummary;
        } catch (e) {
          console.error(`AI \uC0DD\uC131 \uC2E4\uD328: ${p.name} \u2014 ${e.message}`);
        }
      }
    }

    if (!review || review.trim() === "") {
      const upperName = p.name.toUpperCase();
      let tag = "\uac8c\uc774\ubc0d \ubc0f \uba40\ud2f0\ubbf8\ub514\uc5b4 \uc791\uc5c5\uc5d0 \uc801\ud569";
      if (/RTX\s*4090|RTX\s*4080|RX\s*7900/i.test(upperName)) tag = "\ucd5c\uace0 \uc131\ub2a5 \uac8c\uc774\ubc0d \ubc0f 4K \ub80c\ub354\ub9c1\uc5d0 \ucd5c\uc801";
      else if (/RTX\s*4070|RTX\s*4060|RX\s*7800|RX\s*7700/i.test(upperName)) tag = "\uace0\uc131\ub2a5 \uac8c\uc774\ubc0d \ubc0f \ucf58\ud150\uce20 \uc81c\uc791\uc5d0 \uc801\ud569";
      else if (/RTX\s*3060|RTX\s*3050|RX\s*6600/i.test(upperName)) tag = "\uc911\uae09 \uac8c\uc774\ubc0d \ubc0f \uc77c\ubc18 \uc791\uc5c5\uc5d0 \uc801\ud569";
      else if (/GTX|RX\s*5/i.test(upperName)) tag = "\ubcf4\uae09\ud615 \uac8c\uc774\ubc0d \ubc0f \uacbd\ub7c9 \uc791\uc5c5\uc5d0 \uc801\ud569";
      if (score && score >= MIN_3DMARK_SCORE_TO_ATTACH) {
        if (score >= 20000) tag += ", \ud558\uc774\uc5d4\ub4dc \uc131\ub2a5";
        else if (score >= 12000) tag += ", \uc0c1\uae09 \uc131\ub2a5";
        else if (score >= 8000) tag += ", \uc911\uae09 \uc131\ub2a5";
        else tag += ", \ubcf4\uae09\ud615 \uc131\ub2a5";
      }
      review = tag;
    }

    const hasExistingBench = old?.benchmarkScore?.["3dmarkscore"] && old.benchmarkScore["3dmarkscore"] > 0;
    const benchmarkScore = hasExistingBench
      ? old.benchmarkScore
      : (score >= MIN_3DMARK_SCORE_TO_ATTACH ? { "3dmarkscore": score } : undefined);

    const update = {
      category: "gpu",
      image: p.image,
      manufacturer: extractManufacturer(p.name),
      review,
      specSummary,
      ...(benchmarkScore ? { benchmarkScore } : {}),
    };

    if (old) {
      await col.updateOne({ _id: old._id }, { $set: update });
      console.log("\uD83D\uDD01 \uC5C5\uB370\uC774\uD2B8\uB428:", p.name);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      await col.insertOne({
        name: p.name,
        ...update,
        price: p.price,
        mallCount: 0,
        priceHistory: p.price > 0 ? [{ date: today, price: p.price }] : [],
      });
      console.log("\uD83C\uDD95 \uC0BD\uC785\uB428:", p.name);
    }

    if (ai) await sleep(400);
  }

  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "gpu", name: { $in: toDelete } });
    console.log("\uD83D\uDDD1\uFE0F \uc0ad\uc81c\ub428:", toDelete.length, "\uac1c");
  }
}

router.post("/sync-gpus", async (req, res) => {
  if (!acquireLock("gpu")) return res.status(409).json({ error: "SYNC_IN_PROGRESS", running: getRunning() });
  const maxPages = Number(req?.body?.pages) || 5;
  const ai = req.body?.ai !== false;
  const force = req.body?.force === true;

  res.json({ message: `\u2705 GPU \ub3d9\uae30\ud654 \uc2dc\uc791 (pages=${maxPages}, AI: ${ai}, \uac00\uaca9 \ud3ec\ud568)` });
  setImmediate(async () => {
    try {
      const [scores, danawa] = await Promise.all([
        fetchGPUs(),
        crawlDanawaGpus(maxPages),
      ]);
      await saveToDB(scores, danawa, { ai, force });
      invalidatePartsCache();
      console.log("\uD83C\uDF89 \ubaa8\ub4e0 GPU \uc815\ubcf4 \uc800\uc7a5 \uc644\ub8cc");
    } catch (err) {
      console.error("\u274C GPU \ub3d9\uae30\ud654 \uc2e4\ud328:", err);
    } finally { releaseLock("gpu"); }
  });
});

export async function runSync({ pages = 5, ai = true, force = false } = {}) {
  console.log("\n=== GPU 동기화 시작 ===");
  const [scores, danawa] = await Promise.all([fetchGPUs(), crawlDanawaGpus(pages)]);
  await saveToDB(scores, danawa, { ai, force });
  invalidatePartsCache();
  console.log("🎉 GPU 동기화 완료");
}
export default router;
