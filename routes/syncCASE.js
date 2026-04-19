// routes/syncCASE.js
import express from "express";
import { getDB } from "../db.js";
import { launchBrowser } from "../utils/browser.js";

const router = express.Router();

const DANAWA_CASE_URL = "https://prod.danawa.com/list/?cate=112775";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("\u26A0\uFE0F OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `케이스 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/폼팩터/크기/확장성>"}`;

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
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return {
        review: parsed.review || "",
        specSummary: parsed.specSummary || spec,
      };
    } catch (e) {
      console.log(`   \u26A0\uFE0F OpenAI 재시도 ${i + 1}/3 실패:`, e.message);
      if (i < 2) await sleep(1000);
    }
  }

  return { review: "", specSummary: "" };
}

function parseCaseSpecs(name = "", specText = "") {
  const combined = `${name} ${specText}`.toUpperCase();

  let type = "미들타워";
  if (/빅타워|FULL\s*TOWER/i.test(combined)) type = "빅타워";
  else if (/미들타워|MID\s*TOWER/i.test(combined)) type = "미들타워";
  else if (/미니타워|MINI\s*TOWER/i.test(combined)) type = "미니타워";
  else if (/큐브|CUBE/i.test(combined)) type = "큐브";
  else if (/슬림|SLIM/i.test(combined)) type = "슬림";

  const formFactors = [];
  if (/E-?ATX/i.test(combined) && !/MINI|MICRO/i.test(combined)) formFactors.push("E-ATX");
  if (/ATX/i.test(combined) && !/MINI|MICRO|M-?ATX/i.test(combined)) formFactors.push("ATX");
  if (/M-?ATX|MATX|MICRO\s*ATX/i.test(combined)) formFactors.push("mATX");
  if (/MINI-?ITX|ITX/i.test(combined)) formFactors.push("Mini-ITX");

  if (formFactors.length === 0) {
    if (type === "빅타워") formFactors.push("E-ATX", "ATX", "mATX", "Mini-ITX");
    else if (type === "미들타워") formFactors.push("ATX", "mATX", "Mini-ITX");
    else if (type === "미니타워") formFactors.push("mATX", "Mini-ITX");
    else if (type === "큐브") formFactors.push("Mini-ITX");
    else formFactors.push("ATX", "mATX");
  }

  const gpuMatch = combined.match(/GPU[:\s]*(\d+)\s*MM|그래픽카드[:\s]*(\d+)\s*MM|VGA[:\s]*(\d+)\s*MM/i);
  const maxGpuLength = gpuMatch ? parseInt(gpuMatch[1] || gpuMatch[2] || gpuMatch[3]) : 350;

  const coolerMatch = combined.match(/CPU\s*쿨러[:\s]*(\d+)\s*MM|쿨러[:\s]*(\d+)\s*MM/i);
  const maxCpuCoolerHeight = coolerMatch ? parseInt(coolerMatch[1] || coolerMatch[2]) : 165;

  const psuMatch = combined.match(/파워[:\s]*(\d+)\s*MM|PSU[:\s]*(\d+)\s*MM/i);
  const maxPsuLength = psuMatch ? parseInt(psuMatch[1] || psuMatch[2]) : 180;

  const slotMatch = combined.match(/(\d+)\s*슬롯/i);
  const expansionSlots = slotMatch ? parseInt(slotMatch[1]) : 7;

  let sidePanels = "일반";
  if (/강화유리|TEMPERED\s*GLASS/i.test(combined)) sidePanels = "강화유리";
  else if (/아크릴/i.test(combined)) sidePanels = "아크릴";

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
  console.log(`\uD83D\uDD0D 다나와 케이스 크롤링 시작 (최대 ${maxPages}페이지)`);

  const cases = [];
  let browser;

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

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `${DANAWA_CASE_URL}&page=${pageNum}`;
      console.log(`\n\uD83D\uDCC4 페이지 ${pageNum}/${maxPages} 크롤링 중...`);

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
              const spec = specEl?.textContent?.trim() || "";
              if (name) items.push({ name, image, spec, price });
            } catch (e) { console.error("아이템 파싱 오류:", e); }
          });
          return items;
        });

        console.log(`   \u2705 ${pageItems.length}개 케이스 발견`);
        cases.push(...pageItems);
      } catch (e) {
        console.error(`   \u274C 페이지 ${pageNum} 크롤링 실패:`, e.message);
      }

      await sleep(1500);
    }
  } catch (e) {
    console.error("\u274C 크롤링 오류:", e);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n\uD83C\uDF89 총 ${cases.length}개 케이스 크롤링 완료`);
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
        console.log(`\u23ED\uFE0F  건너뜀 (가격 0원): ${caseItem.name}`);
        continue;
      }

      const manufacturer = caseItem.name.split(" ")[0] || "Unknown";
      const specs = parseCaseSpecs(caseItem.name, caseItem.spec);

      const existing = await col.findOne({ category: "case", name: caseItem.name });

      let review = "", specSummary = "";

      if (ai) {
        if (!existing?.review || force) {
          console.log(`\n\uD83E\uDD16 AI 한줄평 생성 중: ${caseItem.name.slice(0, 40)}...`);
          const aiResult = await fetchAiOneLiner({ name: caseItem.name, spec: specs.info });
          review = aiResult.review || existing?.review || "";
          specSummary = aiResult.specSummary || existing?.specSummary || specs.info;
          if (aiResult.review) { aiSuccess++; console.log(`   \u2705 AI 성공: "${aiResult.review.slice(0, 50)}..."`); }
          else { aiFail++; console.log(`   \u26A0\uFE0F AI 실패 (기본값 사용)`); }
        } else {
          review = existing.review;
          specSummary = existing.specSummary || specs.info;
        }
      } else {
        review = existing?.review || "";
        specSummary = existing?.specSummary || specs.info;
      }

      const update = {
        category: "case", manufacturer, info: specs.info, image: caseItem.image, specs,
        price: caseItem.price || 0,
        ...(ai ? { review, specSummary } : {}),
      };

      if (existing) {
        const today = new Date().toISOString().slice(0, 10);
        const ops = { $set: update };
        if (caseItem.price > 0 && caseItem.price !== existing.price) {
          const priceHistory = existing.priceHistory || [];
          if (!priceHistory.some(p => p.date === today)) ops.$push = { priceHistory: { date: today, price: caseItem.price } };
        }
        await col.updateOne({ _id: existing._id }, ops);
        updated++;
        console.log(`\uD83D\uDD01 업데이트: ${caseItem.name} (가격: ${caseItem.price.toLocaleString()}원)`);
      } else {
        const today = new Date().toISOString().slice(0, 10);
        const priceHistory = caseItem.price > 0 ? [{ date: today, price: caseItem.price }] : [];
        await col.insertOne({ name: caseItem.name, ...update, priceHistory });
        inserted++;
        console.log(`\u2728 신규 추가: ${caseItem.name} (가격: ${caseItem.price.toLocaleString()}원)`);
      }
    } catch (e) {
      console.error(`\u274C DB 저장 실패 (${caseItem.name}):`, e.message);
    }
  }

  console.log(`\n\uD83D\uDCCA 동기화 완료: 신규 ${inserted}개, 업데이트 ${updated}개, 건너뜀 ${skipped}개`);
  console.log(`\uD83E\uDD16 AI 요약: 성공 ${aiSuccess}개, 실패 ${aiFail}개`);
}

router.post("/sync-case", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.pages || req.body?.maxPages) || 10;
    const ai = req.body?.ai !== false;
    const force = !!req.body?.force;

    res.json({ message: `\u2705 케이스 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)` });

    setImmediate(async () => {
      try {
        const cases = await crawlDanawa(maxPages);
        if (cases.length === 0) { console.log("\u26D4 크롤링된 데이터 없음"); return; }
        await syncCasesToDB(cases, { ai, force });
        console.log("\uD83C\uDF89 케이스 동기화 완료");
      } catch (e) {
        console.error("\u274C 케이스 동기화 오류:", e);
      }
    });
  } catch (e) {
    console.error("\u274C 케이스 동기화 오류:", e);
    res.status(500).json({ message: "동기화 실패", error: e.message });
  }
});

export default router;
