// routes/syncSTORAGE.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();

const DANAWA_SSD_URL = "https://prod.danawa.com/list/?cate=112760";
const DANAWA_HDD_URL = "https://prod.danawa.com/list/?cate=112763";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("\u26A0\uFE0F OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `스토리지 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/용량/인터페이스/속도>"}`;

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
    "삼성전자", "Samsung", "Western Digital", "WD", "Seagate", "씨게이트",
    "Crucial", "크루셔", "Kingston", "킹스턴", "SK하이닉스", "Toshiba",
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
  console.log(`\uD83D\uDD0D 다나와 ${type} 크롤링 시작 (최대 ${maxPages}페이지)`);

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
      const reqUrl = req.url();
      const resourceType = req.resourceType();
      if (blockHosts.some(h => reqUrl.includes(h))) return req.abort();
      if (resourceType === 'media' || resourceType === 'font') return req.abort();
      return req.continue();
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`\uD83D\uDCC4 페이지 ${pageNum}/${maxPages} 처리 중...`);

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
                console.log(`\u26A0\uFE0F 초기 네비게이션 실패: ${e.message}`);
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

async function saveToMongoDB(storages, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "storage" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const storage of storages) {
    const price = storage.price || 0;
    if (price === 0) { skipped++; console.log(`\u23ED\uFE0F  건너뜀 (가격 0원): ${storage.name}`); continue; }
    if (price > 0 && (price <= 10000 || price >= 1000000)) { skipped++; console.log(`\u23ED\uFE0F  건너뜀 (가격 범위 초과): ${storage.name} (${price.toLocaleString()}원)`); continue; }

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
        if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { date: today, price: storage.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`\uD83D\uDD01 업데이트: ${storage.name} (가격: ${(storage.price ?? 0).toLocaleString()}원)`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const priceHistory = storage.price > 0 ? [{ date: today, price: storage.price }] : [];
      await col.insertOne({ name: storage.name, ...update, priceHistory });
      inserted++;
      console.log(`\uD83C\uDD95 신규 추가: ${storage.name} (가격: ${(storage.price ?? 0).toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(storages.map((s) => s.name));
  const toDelete = existing.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
  if (toDelete.length > 0) {
    await col.deleteMany({ category: "storage", name: { $in: toDelete } });
    console.log(`\uD83D\uDDD1\uFE0F 삭제됨: ${toDelete.length}개`);
  }

  console.log(`\n\uD83D\uDCC8 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개, 건너뜀 ${skipped}개`);
}

router.post("/sync-storage", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({ message: `\u2705 다나와 스토리지 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)` });

    setImmediate(async () => {
      try {
        console.log("\n=== 스토리지 동기화 시작 ===");

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
        if (allStorage.length === 0) { console.log("\u26D4 크롤링된 데이터 없음"); return; }

        await saveToMongoDB(allStorage, { ai, force });
        console.log("\uD83C\uDF89 스토리지 동기화 완료");
      } catch (err) {
        console.error("\u274C 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("\u274C sync-storage 실패", err);
    res.status(500).json({ error: "sync-storage 실패" });
  }
});

export default router;
