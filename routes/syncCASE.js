// routes/syncCASE.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser, setupPage, sleep } from "../utils/browser.js";
import { invalidatePartsCache } from "../utils/recommend-helpers.js";
import { resolvePrice } from "../utils/priceResolver.js";

const router = express.Router();

const DANAWA_CASE_URL = "https://prod.danawa.com/list/?cate=112775";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("\u26a0\ufe0f OPENAI_API_KEY \ubbf8\uc124\uc815");
    return { review: "", specSummary: "" };
  }

  const prompt = `\ucf00\uc774\uc2a4 "${name}"(\uc2a4\ud399: ${spec})\uc758 \ud55c\uc904\ud3c9\uacfc \uc2a4\ud399\uc694\uc57d\uc744 JSON\uc73c\ub85c \uc791\uc131: {"review":"<100\uc790 \uc774\ub0b4>", "specSummary":"<\ud0c0\uc785/\ud3fc\ud329\ud130/\ud06c\uae30/\ud655\uc7a5\uc131>"}`;

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
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return {
        review: parsed.review || "",
        specSummary: parsed.specSummary || spec,
      };
    } catch (e) {
      console.log(`   \u26a0\ufe0f OpenAI \uc7ac\uc2dc\ub3c4 ${i + 1}/3 \uc2e4\ud328:`, e.message);
      if (i < 2) await sleep(1000);
    }
  }

  return { review: "", specSummary: "" };
}

function parseCaseSpecs(name = "", specText = "") {
  const combined = `${name} ${specText}`.toUpperCase();

  let type = "\ubbf8\ub4e4\ud0c0\uc6cc";
  if (/\ube57\ud0c0\uc6cc|FULL\s*TOWER/i.test(combined)) type = "\ube57\ud0c0\uc6cc";
  else if (/\ubbf8\ub4e4\ud0c0\uc6cc|MID\s*TOWER/i.test(combined)) type = "\ubbf8\ub4e4\ud0c0\uc6cc";
  else if (/\ubbf8\ub2c8\ud0c0\uc6cc|MINI\s*TOWER/i.test(combined)) type = "\ubbf8\ub2c8\ud0c0\uc6cc";
  else if (/\ud050\ube0c|CUBE/i.test(combined)) type = "\ud050\ube0c";
  else if (/\uc2ac\ub9bc|SLIM/i.test(combined)) type = "\uc2ac\ub9bc";

  const formFactors = [];
  if (/E-?ATX/i.test(combined) && !/MINI|MICRO/i.test(combined)) formFactors.push("E-ATX");
  if (/ATX/i.test(combined) && !/MINI|MICRO|M-?ATX/i.test(combined)) formFactors.push("ATX");
  if (/M-?ATX|MATX|MICRO\s*ATX/i.test(combined)) formFactors.push("mATX");
  if (/MINI-?ITX|ITX/i.test(combined)) formFactors.push("Mini-ITX");

  if (formFactors.length === 0) {
    if (type === "\ube57\ud0c0\uc6cc") formFactors.push("E-ATX", "ATX", "mATX", "Mini-ITX");
    else if (type === "\ubbf8\ub4e4\ud0c0\uc6cc") formFactors.push("ATX", "mATX", "Mini-ITX");
    else if (type === "\ubbf8\ub2c8\ud0c0\uc6cc") formFactors.push("mATX", "Mini-ITX");
    else if (type === "\ud050\ube0c") formFactors.push("Mini-ITX");
    else formFactors.push("ATX", "mATX");
  }

  const gpuMatch = combined.match(/GPU[:\s]*(\d+)\s*MM|\uadf8\ub798\ud53d\uce74\ub4dc[:\s]*(\d+)\s*MM|VGA[:\s]*(\d+)\s*MM/i);
  const maxGpuLength = gpuMatch ? parseInt(gpuMatch[1] || gpuMatch[2] || gpuMatch[3]) : 350;

  const coolerMatch = combined.match(/CPU\s*\ucfe8\ub7ec[:\s]*(\d+)\s*MM|\ucfe8\ub7ec[:\s]*(\d+)\s*MM/i);
  const maxCpuCoolerHeight = coolerMatch ? parseInt(coolerMatch[1] || coolerMatch[2]) : 165;

  const psuMatch = combined.match(/\ud30c\uc6cc[:\s]*(\d+)\s*MM|PSU[:\s]*(\d+)\s*MM/i);
  const maxPsuLength = psuMatch ? parseInt(psuMatch[1] || psuMatch[2]) : 180;

  const slotMatch = combined.match(/(\d+)\s*\uc2ac\ub86f/i);
  const expansionSlots = slotMatch ? parseInt(slotMatch[1]) : 7;

  let sidePanels = "\uc77c\ubc18";
  if (/\uac15\ud654\uc720\ub9ac|TEMPERED\s*GLASS/i.test(combined)) sidePanels = "\uac15\ud654\uc720\ub9ac";
  else if (/\uc544\ud06c\ub9b4/i.test(combined)) sidePanels = "\uc544\ud06c\ub9b4";

  const usb3Match = combined.match(/USB\s*3\.\d+[:\s]*(\d+)/i);
  const usbCMatch = /USB[-\s]*C|TYPE[-\s]*C/i.test(combined);

  return {
    type,
    formFactor: formFactors,
    maxGpuLength,
    maxCpuCoolerHeight,
    maxPsuLength,
    expansionSlots,
    sidePanels,
    frontPorts: {
      usb3: usb3Match ? parseInt(usb3Match[1]) : 2,
      usbC: usbCMatch ? 1 : 0,
    },
    info: `${type}, ${formFactors.join("/")}, ${sidePanels}`.trim(),
  };
}

async function crawlDanawa(maxPages = 10) {
  console.log(`\uD83D\uDD0D \ub2e4\ub098\uc640 \ucf00\uc774\uc2a4 \ud06c\ub864\ub9c1 \uc2dc\uc791 (\ucd5c\ub300 ${maxPages}\ud398\uc774\uc9c0)`);

  const cases = [];
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await setupPage(page, 60000);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `${DANAWA_CASE_URL}&page=${pageNum}`;
      console.log(`\n\uD83D\uDCC4 \ud398\uc774\uc9c0 ${pageNum}/${maxPages} \ud06c\ub864\ub9c1 \uc911...`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(2000);

        const pageItems = await page.evaluate(() => {
          const items = [];
          const rows = document.querySelectorAll(".product_list .prod_item");

          rows.forEach((row) => {
            try {
              const nameEl = row.querySelector(".prod_name a");
              const specEl = row.querySelector(".spec_list");
              const priceEl = row.querySelector('.price_sect a strong');
              let price = 0;
              if (priceEl) price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;

              const name = nameEl?.textContent?.trim() || "";
              let image = '';
              const thumbLink = row.querySelector('.thumb_link') || row.querySelector('a.thumb_link');
              let imgEl = null;
              if (thumbLink) imgEl = thumbLink.querySelector('img') || thumbLink.querySelector('picture img');
              if (!imgEl) imgEl = row.querySelector('.thumb_image img') || row.querySelector('img') || row.querySelector('.prod_img img') || row.querySelector('picture img') || row.querySelector('.img_wrap img');
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
                const bgEl = thumbLink || row.querySelector('.thumb_image') || row.querySelector('.prod_img');
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
              const spec = specEl?.textContent?.trim() || "";
              if (name) items.push({ name, image, spec, price });
            } catch (e) { console.error("\uc544\uc774\ud15c \ud30c\uc2f1 \uc624\ub958:", e); }
          });
          return items;
        });

        console.log(`   \u2705 ${pageItems.length}\uac1c \ucf00\uc774\uc2a4 \ubc1c\uacac`);
        cases.push(...pageItems);
      } catch (e) {
        console.error(`   \u274C \ud398\uc774\uc9c0 ${pageNum} \ud06c\ub864\ub9c1 \uc2e4\ud328:`, e.message);
      }

      await sleep(1500);
    }
  } catch (e) {
    console.error("\u274C \ud06c\ub864\ub9c1 \uc624\ub958:", e);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n\uD83C\uDF89 \ucd1d ${cases.length}\uac1c \ucf00\uc774\uc2a4 \ud06c\ub864\ub9c1 \uc644\ub8cc`);
  return cases;
}

async function syncCasesToDB(cases, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");

  let inserted = 0, updated = 0, aiSuccess = 0, aiFail = 0, skipped = 0;

  for (const caseItem of cases) {
    try {
      if (!caseItem.price || caseItem.price === 0) {
        skipped++;
        console.log(`\u23ed\ufe0f  \uac74\ub108\ub700 (\uac00\uaca9 0\uc6d0): ${caseItem.name}`);
        continue;
      }

      const manufacturer = caseItem.name.split(" ")[0] || "Unknown";
      const specs = parseCaseSpecs(caseItem.name, caseItem.spec);

      const existing = await col.findOne({ category: "case", name: caseItem.name });

      let review = "", specSummary = "";

      if (ai) {
        if (!existing?.review || force) {
          console.log(`\n\uD83E\uDD16 AI \ud55c\uc904\ud3c9 \uc0dd\uc131 \uc911: ${caseItem.name.slice(0, 40)}...`);
          const aiResult = await fetchAiOneLiner({ name: caseItem.name, spec: specs.info });
          review = aiResult.review || existing?.review || "";
          specSummary = aiResult.specSummary || existing?.specSummary || specs.info;
          if (aiResult.review) { aiSuccess++; console.log(`   \u2705 AI \uc131\uacf5: "${aiResult.review.slice(0, 50)}..."`); }
          else { aiFail++; console.log(`   \u26a0\ufe0f AI \uc2e4\ud328 (\uae30\ubcf8\uac12 \uc0ac\uc6a9)`); }
        } else {
          review = existing.review;
          specSummary = existing.specSummary || specs.info;
        }
      } else {
        review = existing?.review || "";
        specSummary = existing?.specSummary || specs.info;
      }

      const resolvedCase = await resolvePrice(caseItem.name, caseItem.price);
      const update = {
        category: "case", manufacturer, info: specs.info, image: caseItem.image, specs,
        price: resolvedCase.price || 0, danawaPrice: resolvedCase.danawaPrice || 0,
        ...(ai ? { review, specSummary } : {}),
      };

      if (existing) {
        const today = new Date().toISOString().slice(0, 10);
        const ops = { $set: update };
        if (resolvedCase.price > 0 && resolvedCase.price !== existing.price) {
          const priceHistory = existing.priceHistory || [];
          if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { $each: [{ date: today, price: resolvedCase.price }], $slice: -90 } };
        }
        await col.updateOne({ _id: existing._id }, ops);
        updated++;
        console.log(`\uD83D\uDD01 \uc5c5\ub370\uc774\ud2b8: ${caseItem.name} (\uac00\uaca9: ${caseItem.price.toLocaleString()}\uc6d0)`);
      } else {
        const today = new Date().toISOString().slice(0, 10);
        const priceHistory = resolvedCase.price > 0 ? [{ date: today, price: resolvedCase.price }] : [];
        await col.insertOne({ name: caseItem.name, ...update, priceHistory });
        inserted++;
        console.log(`\u2728 \uc2e0\uaddc \ucd94\uac00: ${caseItem.name} (\uac00\uaca9: ${caseItem.price.toLocaleString()}\uc6d0)`);
      }
    } catch (e) {
      console.error(`\u274C DB \uc800\uc7a5 \uc2e4\ud328 (${caseItem.name}):`, e.message);
    }
  }

  console.log(`\n\uD83D\uDCCA \ub3d9\uae30\ud654 \uc644\ub8cc: \uc2e0\uaddc ${inserted}\uac1c, \uc5c5\ub370\uc774\ud2b8 ${updated}\uac1c, \uac74\ub108\ub700 ${skipped}\uac1c`);
  console.log(`\uD83E\uDD16 AI \uc694\uc57d: \uc131\uacf5 ${aiSuccess}\uac1c, \uc2e4\ud328 ${aiFail}\uac1c`);
}

router.post("/sync-case", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 10;
    const ai = req.body?.ai !== false;
    const force = !!req.body?.force;

    res.json({ message: `\u2705 \ucf00\uc774\uc2a4 \ub3d9\uae30\ud654 \uc2dc\uc791 (pages=${maxPages}, ai=${ai}, \uac00\uaca9 \ud3ec\ud568)` });

    setImmediate(async () => {
      try {
        const cases = await crawlDanawa(maxPages);
        if (cases.length === 0) { console.log("\u26D4 \ud06c\ub864\ub9c1\ub41c \ub370\uc774\ud130 \uc5c6\uc74c"); return; }
        await syncCasesToDB(cases, { ai, force });
        invalidatePartsCache();
        console.log("\uD83C\uDF89 \ucf00\uc774\uc2a4 \ub3d9\uae30\ud654 \uc644\ub8cc");
      } catch (e) {
        console.error("\u274C \ucf00\uc774\uc2a4 \ub3d9\uae30\ud654 \uc624\ub958:", e);
      }
    });
  } catch (e) {
    console.error("\u274C \ucf00\uc774\uc2a4 \ub3d9\uae30\ud654 \uc624\ub958:", e);
    res.status(500).json({ message: "\ub3d9\uae30\ud654 \uc2e4\ud328", error: e.message });
  }
});

export default router;
