// routes/syncSTORAGE.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser, setupPage, navigateToDanawaPage, sleep } from "../utils/browser.js";
import { invalidatePartsCache } from "../utils/recommend-helpers.js";

const router = express.Router();

const DANAWA_SSD_URL = "https://prod.danawa.com/list/?cate=112760";
const DANAWA_HDD_URL = "https://prod.danawa.com/list/?cate=112763";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("\u26A0\uFE0F OPENAI_API_KEY \ubbf8\uc124\uc815");
    return { review: "", specSummary: "" };
  }

  const prompt = `\uc2a4\ud1a0\ub9ac\uc9c0 "${name}"(\uc2a4\ud399: ${spec})\uc758 \ud55c\uc904\ud3c9\uacfc \uc2a4\ud399\uc694\uc57d\uc744 JSON\uc73c\ub85c \uc791\uc131: {"review":"<100\uc790 \uc774\ub0b4>", "specSummary":"<\ud0c0\uc785/\uc6a9\ub7c9/\uc778\ud130\ud398\uc774\uc2a4/\uc18d\ub3c4>"}`;

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
            { role: "system", content: "\ub108\ub294 PC \ubd80\ud488 \uc804\ubb38\uac00\uc57c. JSON\ub9cc \ucd9c\ub825\ud574." },
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

function extractManufacturer(name) {
  const brands = [
    "\uc0bc\uc131\uc804\uc790", "Samsung", "Western Digital", "WD", "Seagate", "\uc528\uac8c\uc774\ud2b8",
    "Crucial", "\ud06c\ub8e8\uc154", "Kingston", "\ud0b9\uc2a4\ud134", "SK\ud558\uc774\ub2c9\uc2a4", "Toshiba",
    "Sabrent", "ADATA", "Corsair", "Intel", "Micron", "SanDisk"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "";
}

function parseStorageSpecs(name = "", spec = "", type = "SSD") {
  const combined = `${name} ${spec}`;
  const parts = [];

  const capacityMatch = combined.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  let capacity = "";
  if (capacityMatch) {
    const value = parseFloat(capacityMatch[1]);
    const unit = capacityMatch[2].toUpperCase();
    capacity = `${value}${unit}`;
    parts.push(`\uc6a9\ub7c9: ${capacity}`);
  }

  if (type === "SSD") {
    if (/NVMe/i.test(combined)) parts.push("\uc778\ud130\ud398\uc774\uc2a4: NVMe");
    else if (/SATA/i.test(combined)) parts.push("\uc778\ud130\ud398\uc774\uc2a4: SATA");
    if (/M\.2/i.test(combined)) parts.push("\ud3fc\ud329\ud130: M.2");
    else if (/2\.5"/i.test(combined)) parts.push('\ud3fc\ud329\ud130: 2.5"');
    const pcieMatch = combined.match(/PCIe\s*(\d\.\d|[3-5])/i);
    if (pcieMatch) parts.push(`PCIe: Gen${pcieMatch[1]}`);
    const readMatch = combined.match(/\uc77d\uae30[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i);
    if (readMatch) parts.push(`\uc77d\uae30: ${readMatch[1]}MB/s`);
    const writeMatch = combined.match(/\uc4f0\uae30[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i);
    if (writeMatch) parts.push(`\uc4f0\uae30: ${writeMatch[1]}MB/s`);
    const tbwMatch = combined.match(/TBW[:\s]*(\d+(?:,\d+)?)\s*TB/i);
    if (tbwMatch) parts.push(`TBW: ${tbwMatch[1]}TB`);
  } else if (type === "HDD") {
    const rpmMatch = combined.match(/(\d+)\s*RPM/i);
    if (rpmMatch) parts.push(`RPM: ${rpmMatch[1]}`);
    const cacheMatch = combined.match(/\uce90\uc2dc[:\s]*(\d+)\s*MB/i);
    if (cacheMatch) parts.push(`\uce90\uc2dc: ${cacheMatch[1]}MB`);
    if (/SATA/i.test(combined)) parts.push("\uc778\ud130\ud398\uc774\uc2a4: SATA");
  }

  const warrantyMatch = combined.match(/(\d+)\ub144\s*\ubcf4\uc99d/i);
  if (warrantyMatch) parts.push(`\ubcf4\uc99d: ${warrantyMatch[1]}\ub144`);

  return {
    type,
    interface: type === "SSD" ? (/NVMe/i.test(combined) ? "NVMe" : "SATA") : "SATA",
    formFactor: /M\.2/i.test(combined) ? "M.2" : '2.5"',
    capacity,
    pcieGen: type === "SSD" ? (combined.match(/PCIe\s*(\d\.\d|[3-5])/i)?.[1] || "") : "",
    readSpeed: type === "SSD" ? (combined.match(/\uc77d\uae30[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i)?.[1] || "") : "",
    writeSpeed: type === "SSD" ? (combined.match(/\uc4f0\uae30[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i)?.[1] || "") : "",
    tbw: type === "SSD" ? (combined.match(/TBW[:\s]*(\d+(?:,\d+)?)\s*TB/i)?.[1] || "") : "",
    rpm: type === "HDD" ? (combined.match(/(\d+)\s*RPM/i)?.[1] || "") : "",
    cache: type === "HDD" ? (combined.match(/\uce90\uc2dc[:\s]*(\d+)\s*MB/i)?.[1] || "") : "",
    warranty: warrantyMatch?.[1] || "",
    info: parts.join(", "),
    specText: spec
  };
}

function calculateStorageScore(name = "", spec = "", type = "SSD") {
  const combined = `${name} ${spec}`.toUpperCase();
  let score = 0;

  if (type === "SSD") {
    if (/NVME/i.test(combined)) {
      score = 50000;
      const pcieGenMatch = combined.match(/PCIe\s*(?:GEN\s*)?(\d\.\d|[3-5])/i);
      if (pcieGenMatch) {
        const gen = parseFloat(pcieGenMatch[1]);
        if (gen >= 5.0) score += 30000;
        else if (gen >= 4.0) score += 20000;
        else if (gen >= 3.0) score += 10000;
      }
    } else if (/SATA/i.test(combined)) {
      score = 20000;
    }
    const readMatch = combined.match(/\uc77d\uae30[:\s]*(\d+(?:,\d+)?)\s*MB\/S/i);
    if (readMatch) score += Math.min(parseInt(readMatch[1].replace(/,/g, '')) / 10, 5000);
    const writeMatch = combined.match(/\uc4f0\uae30[:\s]*(\d+(?:,\d+)?)\s*MB\/S/i);
    if (writeMatch) score += Math.min(parseInt(writeMatch[1].replace(/,/g, '')) / 10, 5000);
  } else if (type === "HDD") {
    score = 10000;
    const rpmMatch = combined.match(/(\d+)\s*RPM/i);
    if (rpmMatch) {
      const rpm = parseInt(rpmMatch[1]);
      if (rpm >= 7200) score += 5000;
      else if (rpm >= 5400) score += 2000;
      else score += 1000;
    }
    const cacheMatch = combined.match(/\uce90\uc2dc[:\s]*(\d+)\s*MB/i);
    if (cacheMatch) score += Math.min(parseInt(cacheMatch[1]) / 10, 2000);
  }

  return Math.max(score, 0);
}

async function crawlDanawaStorage(url, type = "SSD", maxPages = 10) {
  console.log(`\uD83D\uDD0D \ub2e4\ub098\uc640 ${type} \ud06c\ub864\ub9c1 \uc2dc\uc791 (\ucd5c\ub300 ${maxPages}\ud398\uc774\uc9c0)`);

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
          const navigateWithRetry = async (targetUrl) => {
            let attempts = 3;
            while (attempts--) {
              try {
                await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
                await sleep(1000);
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await sleep(3000);
                await page.waitForSelector(".main_prodlist .prod_item, ul.product_list > li.prod_item", { timeout: 20000 });
                return true;
              } catch (e) {
                console.log(`\u26A0\uFE0F \ucd08\uae30 \ub124\ube44\uac8c\uc774\uc158 \uc2e4\ud328: ${e.message}`);
                if (!attempts) throw e;
              }
            }
          };

          await navigateWithRetry(url);

          for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await sleep(400);
          }
        } else {
          try {
            await navigateToDanawaPage(page, pageNum, 'ul.product_list > li.prod_item');
          } catch (navError) {
            console.log(`\u274C \ud398\uc774\uc9c0 ${pageNum} \uc774\ub3d9 \uc2e4\ud328: ${navError.message}`);
            continue;
          }
          await sleep(2000);
        }

        await page.waitForSelector(".main_prodlist .prod_item, ul.product_list > li.prod_item", { timeout: 20000 });

        const items = await page.evaluate(() => {
          const nodeList = document.querySelectorAll("ul.product_list > li.prod_item, .main_prodlist .product_list .prod_item");
          return Array.from(nodeList).map((li) => {
            const nameEl = li.querySelector("p.prod_name a");
            let image = '';
            const thumbLink = li.querySelector('a.thumb_link') || li.querySelector('.thumb_link');
            let imgEl = null;
            if (thumbLink) imgEl = thumbLink.querySelector('img') || thumbLink.querySelector('picture img');
            if (!imgEl) imgEl = li.querySelector('img') || li.querySelector('.thumb_image img') || li.querySelector('.prod_img img') || li.querySelector('picture img') || li.querySelector('.img_wrap img');
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
              const bgEl = thumbLink || li.querySelector('.thumb_image') || li.querySelector('.prod_img');
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
            const specEl = li.querySelector("div.spec_list");
            const priceEl = li.querySelector('.price_sect a strong');
            let price = 0;
            if (priceEl) price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;
            return {
              name: nameEl?.textContent?.trim() || "",
              image,
              spec: specEl?.textContent?.trim() || "",
              price,
            };
          });
        });

        products.push(...items.filter((p) => p.name));
        console.log(`\u2705 \ud398\uc774\uc9c0 ${pageNum}: ${items.length}\uac1c \uc218\uc9d1 \uc644\ub8cc`);
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

async function saveToMongoDB(storages, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "storage" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const storage of storages) {
    const price = storage.price || 0;
    if (price === 0) { skipped++; console.log(`\u23ED\uFE0F  \uac74\ub108\ub700 (\uac00\uaca9 0\uc6d0): ${storage.name}`); continue; }
    if (price > 0 && (price <= 10000 || price >= 1000000)) { skipped++; console.log(`\u23ED\uFE0F  \uac74\ub108\ub700 (\uac00\uaca9 \ubc94\uc704 \ucd08\uacfc): ${storage.name} (${price.toLocaleString()}\uc6d0)`); continue; }

    const old = byName.get(storage.name);
    const storageScore = calculateStorageScore(storage.name, storage.spec, storage.specs?.type || "SSD");

    let review = "", specSummary = "";
    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({ name: storage.name, spec: storage.spec });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "storage",
      info: storage.info,
      image: storage.image,
      manufacturer: extractManufacturer(storage.name),
      specs: storage.specs,
      price: storage.price || 0,
      benchmarkScore: storageScore > 0 ? { "storagescore": storageScore } : undefined,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };
      if (storage.price > 0 && storage.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { $each: [{ date: today, price: storage.price }], $slice: -90 } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`\uD83D\uDD01 \uc5c5\ub370\uc774\ud2b8: ${storage.name} (\uac00\uaca9: ${(storage.price ?? 0).toLocaleString()}\uc6d0)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const priceHistory = storage.price > 0 ? [{ date: today, price: storage.price }] : [];
      await col.insertOne({ name: storage.name, ...update, priceHistory });
      inserted++;
      console.log(`\uD83C\uDD95 \uc2e0\uaddc \ucd94\uac00: ${storage.name} (\uac00\uaca9: ${(storage.price ?? 0).toLocaleString()}\uc6d0)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(storages.map((s) => s.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "storage", name: { $in: toDelete } });
    console.log(`\uD83D\uDDD1\uFE0F \uc0ad\uc81c\ub428: ${toDelete.length}\uac1c`);
  }

  console.log(`\n\uD83D\uDCC8 \ucd5c\uc885 \uacb0\uacfc: \uc0bd\uc785 ${inserted}\uac1c, \uc5c5\ub370\uc774\ud2b8 ${updated}\uac1c, \uc0ad\uc81c ${toDelete.length}\uac1c, \uac74\ub108\ub700 ${skipped}\uac1c`);
}

router.post("/sync-storage", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({ message: `\u2705 \ub2e4\ub098\uc640 \uc2a4\ud1a0\ub9ac\uc9c0 \ub3d9\uae30\ud654 \uc2dc\uc791 (pages=${maxPages}, ai=${ai}, \uac00\uaca9 \ud3ec\ud568)` });

    setImmediate(async () => {
      try {
        console.log("\n=== \uc2a4\ud1a0\ub9ac\uc9c0 \ub3d9\uae30\ud654 \uc2dc\uc791 ===");

        const ssdProducts = await crawlDanawaStorage(DANAWA_SSD_URL, "SSD", maxPages);
        const ssdData = ssdProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "SSD");
          return { name: p.name, image: p.image, info: specs.info, spec: specs.specText, price: p.price || 0, specs: { type: specs.type, interface: specs.interface, formFactor: specs.formFactor, capacity: specs.capacity, pcieGen: specs.pcieGen, readSpeed: specs.readSpeed, writeSpeed: specs.writeSpeed, tbw: specs.tbw, warranty: specs.warranty } };
        });

        const hddProducts = await crawlDanawaStorage(DANAWA_HDD_URL, "HDD", maxPages);
        const hddData = hddProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "HDD");
          return { name: p.name, image: p.image, info: specs.info, spec: specs.specText, price: p.price || 0, specs: { type: specs.type, interface: specs.interface, formFactor: specs.formFactor, capacity: specs.capacity, rpm: specs.rpm, cache: specs.cache, warranty: specs.warranty } };
        });

        const allStorage = [...ssdData, ...hddData];
        if (allStorage.length === 0) { console.log("\u26D4 \ud06c\ub864\ub9c1\ub41c \ub370\uc774\ud130 \uc5c6\uc74c"); return; }

        await saveToMongoDB(allStorage, { ai, force });
        invalidatePartsCache();
        console.log("\uD83C\uDF89 \uc2a4\ud1a0\ub9ac\uc9c0 \ub3d9\uae30\ud654 \uc644\ub8cc");
      } catch (err) {
        console.error("\u274C \ub3d9\uae30\ud654 \uc2e4\ud328:", err);
      }
    });
  } catch (err) {
    console.error("\u274C sync-storage \uc2e4\ud328", err);
    res.status(500).json({ error: "sync-storage \uc2e4\ud328" });
  }
});

export default router;
