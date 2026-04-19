// routes/syncCOOLER.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();

const DANAWA_COOLER_URL = "https://prod.danawa.com/list/?cate=11236855";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("\u26A0\uFE0F OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `쿨러 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/소켓/TDP/높이>"}`;

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

function extractManufacturer(name) {
  const brands = [
    "써멀라이트", "Thermalright", "딥쿨", "Deepcool", "쿨러마스터", "Cooler Master",
    "녹투아", "Noctua", "비쿱", "Be Quiet", "커세어", "Corsair",
    "NZXT", "Arctic", "Zalman", "ID-COOLING", "Enermax", "Scythe"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "";
}

function extractCoolerInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const parts = [];

  if (/수냉|AIO|일체형\s*수냉/i.test(combined)) {
    parts.push("수냉 쿨러");
    const radMatch = combined.match(/(\d{3})mm|(\d{2,3})\s*(?:mm)?/i);
    if (radMatch) {
      const size = radMatch[1] || radMatch[2];
      if (["120","240","280","360","420"].includes(size)) parts.push(`라디에이터: ${size}mm`);
    }
  } else {
    parts.push("공랭 쿨러");
  }

  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  if (tdpMatch) parts.push(`TDP: ${tdpMatch[1]}W`);

  const heightMatch = combined.match(/높이[:\s]*(\d{2,3})mm?|(\d{2,3})\s*mm/i);
  if (heightMatch) {
    const height = heightMatch[1] || heightMatch[2];
    if (parseInt(height) > 50 && parseInt(height) < 200) parts.push(`높이: ${height}mm`);
  }

  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1x]/i.test(combined)) sockets.push("LGA115x");
  if (sockets.length > 0) parts.push(`소켓: ${sockets.join(", ")}`);

  if (/ARGB|RGB/i.test(combined)) parts.push("RGB");

  return parts.join(", ");
}

function parseCoolerSpecs(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const isWaterCooling = /수냉|AIO|일체형\s*수냉/i.test(combined);

  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1x]/i.test(combined)) sockets.push("LGA115x");

  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  const tdpW = tdpMatch ? parseInt(tdpMatch[1]) : 0;

  const heightMatch = combined.match(/높이[:\s]*(\d{2,3})mm?|(\d{2,3})\s*mm/i);
  const heightMm = heightMatch ? parseInt(heightMatch[1] || heightMatch[2]) : 0;

  return {
    type: isWaterCooling ? "수냉" : "공랭",
    sockets,
    tdpW,
    heightMm,
    info: extractCoolerInfo(name, spec),
    specText: spec
  };
}

async function crawlDanawaCoolers(maxPages = 10) {
  console.log(`\uD83D\uDD0D 다나와 쿨러 크롤링 시작 (최대 ${maxPages}페이지)`);

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
      const resourceType = req.resourceType();
      if (blockHosts.some(h => url.includes(h))) return req.abort();
      if (resourceType === 'media' || resourceType === 'font') return req.abort();
      return req.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\uD83D\uDCC4 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        if (pageNum === 1) {
          let retries = 3;
          let loaded = false;
          while (retries > 0 && !loaded) {
            try {
              await page.goto(DANAWA_COOLER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
              loaded = true;
            } catch (err) {
              retries--;
              if (retries === 0) throw err;
              await sleep(3000);
            }
          }
        } else {
          try {
            const pageSelector = `a.num[page="${pageNum}"]`;
            const pageExists = await page.evaluate((selector) => document.querySelector(selector) !== null, pageSelector);

            if (pageExists) {
              await page.click(pageSelector);
              await sleep(5000);
              await page.waitForFunction(() => document.querySelectorAll('ul.product_list > li.prod_item').length > 0, { timeout: 30000 });
            } else {
              await page.evaluate((p) => {
                if (typeof movePage === "function") movePage(p);
                else if (typeof goPage === "function") goPage(p);
                else if (typeof changePage === "function") changePage(p);
                else throw new Error('페이지 이동 함수를 찾을 수 없음');
              }, pageNum);
              await sleep(5000);
              await page.waitForFunction(() => document.querySelectorAll('ul.product_list > li.prod_item').length > 0, { timeout: 30000 });
            }
          } catch (navError) {
            console.log(`\u274C 페이지 ${pageNum} 이동 실패: ${navError.message}`);
            continue;
          }

          await sleep(2000);
        }

        await page.waitForSelector("ul.product_list > li.prod_item", { timeout: 10000 });

        const items = await page.evaluate(() => {
          const liList = Array.from(document.querySelectorAll("ul.product_list > li.prod_item"));
          return liList.map((li) => {
            const specEl = li.querySelector("div.spec_list");
            const priceEl = li.querySelector('.price_sect a strong');
            let price = 0;
            if (priceEl) price = parseInt(priceEl.textContent.replace(/[^0-9]/g, ''), 10) || 0;

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
                if (bgImage && bgImage !== 'none') { const m = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/); if (m?.[1]) { image = m[1]; if (image.startsWith('//')) image = 'https:' + image; else if (image.startsWith('/')) image = 'https://img.danawa.com' + image; } }
              }
            }
            const nameEl = li.querySelector("p.prod_name a");
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

            return {
              name: nameEl?.textContent?.trim() || "",
              image,
              spec: specEl?.textContent?.trim() || "",
              price,
            };
          });
        });

        products.push(...items.filter((p) => p.name));
        console.log(`\u2705 페이지 ${pageNum}: ${items.length}개 수집 완료`);
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

async function saveToMongoDB(coolers, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cooler" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const cooler of coolers) {
    if (!cooler.price || cooler.price === 0) {
      skipped++;
      console.log(`\u23ED\uFE0F  건너뜀 (가격 0원): ${cooler.name}`);
      continue;
    }

    const old = byName.get(cooler.name);
    const specs = parseCoolerSpecs(cooler.name, cooler.spec);

    if (!specs.sockets || specs.sockets.length === 0) {
      skipped++;
      console.log(`\u23ED\uFE0F  건너뜀 (소켓 정보 없음): ${cooler.name}`);
      continue;
    }

    let review = "", specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({ name: cooler.name, spec: cooler.spec });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "cooler",
      info: specs.info,
      image: cooler.image,
      manufacturer: extractManufacturer(cooler.name),
      specs: { type: specs.type, sockets: specs.sockets, tdpW: specs.tdpW, heightMm: specs.heightMm, specText: specs.specText },
      price: cooler.price || 0,
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };
      if (cooler.price > 0 && cooler.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { date: today, price: cooler.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`\uD83D\uDD01 업데이트: ${cooler.name} (가격: ${cooler.price.toLocaleString()}원)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const priceHistory = cooler.price > 0 ? [{ date: today, price: cooler.price }] : [];
      await col.insertOne({ name: cooler.name, ...update, priceHistory });
      inserted++;
      console.log(`\uD83C\uDD95 신규 추가: ${cooler.name} (가격: ${cooler.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(coolers.map((c) => c.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cooler", name: { $in: toDelete } });
    console.log(`\uD83D\uDDD1\uFE0F 삭제됨: ${toDelete.length}개`);
  }

  console.log(`\n\uD83D\uDCC8 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개`);
}

router.post("/sync-cooler", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({ message: `\u2705 다나와 쿨러 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)` });

    setImmediate(async () => {
      try {
        console.log("\n=== 쿨러 동기화 시작 ===");
        const coolers = await crawlDanawaCoolers(maxPages);
        if (coolers.length === 0) { console.log("\u26D4 크롤링된 데이터 없음"); return; }
        await saveToMongoDB(coolers, { ai, force });
        console.log("\uD83C\uDF89 쿨러 동기화 완료");
      } catch (err) {
        console.error("\u274C 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("\u274C sync-cooler 실패", err);
    res.status(500).json({ error: "sync-cooler 실패" });
  }
});

export default router;
