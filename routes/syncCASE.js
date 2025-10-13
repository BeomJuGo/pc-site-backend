// routes/syncCASE.js - Puppeteer 버전 (개선)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_CASE_URL = "https://prod.danawa.com/list/?cate=112775";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `케이스 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/폼팩터/특징>"}`;

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
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

/* ==================== 케이스 스펙 파싱 ==================== */
function parseCaseSpecs(name = "", specText = "") {
  const combined = `${name} ${specText}`.toUpperCase();

  let type = "미들타워";
  if (/빅타워|FULL\s*TOWER/i.test(combined)) type = "빅타워";
  else if (/미들타워|MID\s*TOWER/i.test(combined)) type = "미들타워";
  else if (/미니타워|MINI\s*TOWER/i.test(combined)) type = "미니타워";
  else if (/큐브|CUBE/i.test(combined)) type = "큐브";

  const formFactors = [];
  if (/E-ATX|EATX/i.test(combined)) formFactors.push("E-ATX");
  if (/ATX/i.test(combined) && !/MINI|MICRO|M-ATX/i.test(combined)) formFactors.push("ATX");
  if (/M-ATX|MATX|MICRO\s*ATX/i.test(combined)) formFactors.push("mATX");
  if (/MINI-ITX|ITX/i.test(combined)) formFactors.push("Mini-ITX");
  if (formFactors.length === 0) formFactors.push("ATX");

  const gpuMatch = combined.match(/GPU[:\s]*(\d+)\s*MM|그래픽카드[:\s]*(\d+)\s*MM/i);
  const maxGpuLength = gpuMatch ? parseInt(gpuMatch[1] || gpuMatch[2]) : 350;

  const coolerMatch = combined.match(/CPU\s*쿨러[:\s]*(\d+)\s*MM|쿨러[:\s]*(\d+)\s*MM/i);
  const maxCpuCoolerHeight = coolerMatch ? parseInt(coolerMatch[1] || coolerMatch[2]) : 160;

  const psuMatch = combined.match(/파워[:\s]*(\d+)\s*MM|PSU[:\s]*(\d+)\s*MM/i);
  const maxPsuLength = psuMatch ? parseInt(psuMatch[1] || psuMatch[2]) : 180;

  const slotMatch = combined.match(/(\d+)\s*슬롯/i);
  const expansionSlots = slotMatch ? parseInt(slotMatch[1]) : 7;

  let sidePanels = "일반";
  if (/강화유리|TEMPERED\s*GLASS/i.test(combined)) sidePanels = "강화유리";
  else if (/아크릴|ACRYLIC/i.test(combined)) sidePanels = "아크릴";

  const usb3Match = combined.match(/USB\s*3\.\d[^\d]*(\d+)/i);
  const usbCMatch = combined.match(/USB[-\s]*C|TYPE[-\s]*C/i);

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
      usbC: usbCMatch ? 1 : 0
    },
    info: `${type}, ${formFactors.join("/")}, ${sidePanels}`.trim()
  };
}

/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name = "") {
  const brands = [
    "NZXT", "Fractal Design", "Corsair", "Lian Li", "Cooler Master",
    "Phanteks", "be quiet!", "Thermaltake", "darkFlash", "ABKO", "Zalman"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "기타";
}

/* ==================== Puppeteer 크롤링 ==================== */
async function crawlDanawaCases(maxPages = 3) {
  console.log(`🔍 케이스 크롤링 시작 (최대 ${maxPages}페이지)`);
  let browser;
  const products = [];

  try {
    chromium.setGraphicsMode = false;
    browser = await puppeteer.launch({
      args: [...chromium.args, '--disable-gpu', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        if (pageNum === 1) {
          await page.goto(DANAWA_CASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(3000);
        } else {
          await page.evaluate((p) => movePage(p), pageNum);
          await sleep(5000);
        }

        const pageProducts = await page.evaluate(() => {
          const items = document.querySelectorAll('.prod_item');
          return Array.from(items).map(item => ({
            name: item.querySelector('.prod_name a')?.textContent?.trim(),
            price: parseInt(item.querySelector('.price_sect strong')?.textContent?.replace(/[^\d]/g, '')) || 0,
            image: item.querySelector('img')?.src || '',
            spec: item.querySelector('.spec_list')?.textContent?.trim() || ''
          })).filter(p => p.name && p.price > 0);
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개`);
        products.push(...pageProducts);

        if (pageProducts.length === 0) break;
      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 실패:`, e.message);
        if (pageNum === 1) break;
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  return products;
}

/* ==================== MongoDB 저장 ==================== */
async function saveToMongoDB(cases, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "case" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0;

  for (const caseItem of cases) {
    const old = byName.get(caseItem.name);
    let review = "", specSummary = "";

    if (ai && (!old?.review || force)) {
      const aiRes = await fetchAiOneLiner({ name: caseItem.name, spec: caseItem.spec });
      review = aiRes.review || old?.review || "";
      specSummary = aiRes.specSummary || old?.specSummary || "";
    } else if (old) {
      review = old.review;
      specSummary = old.specSummary || "";
    }

    const update = {
      category: "case",
      info: caseItem.info,
      price: caseItem.price,
      image: caseItem.image,
      manufacturer: caseItem.manufacturer,
      specs: caseItem.specs,
      ...(ai ? { review, specSummary } : {}),
    };

    const today = new Date().toISOString().slice(0, 10);

    if (old) {
      const ops = { $set: update };
      if (caseItem.price > 0 && !old.priceHistory?.some(p => p.date === today)) {
        ops.$push = { priceHistory: { date: today, price: caseItem.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
    } else {
      await col.insertOne({
        name: caseItem.name,
        ...update,
        priceHistory: caseItem.price > 0 ? [{ date: today, price: caseItem.price }] : [],
      });
      inserted++;
    }

    if (ai) await sleep(200);
  }

  console.log(`📈 삽입 ${inserted}개, 업데이트 ${updated}개`);
}

/* ==================== 라우터 ==================== */
router.post("/sync-case", async (req, res) => {
  const maxPages = Number(req?.body?.pages) || 3;
  const ai = req?.body?.ai !== false;
  const force = !!req?.body?.force;

  res.json({ message: `✅ 케이스 동기화 시작 (pages=${maxPages}, ai=${ai})` });

  setImmediate(async () => {
    try {
      const products = await crawlDanawaCases(maxPages);

      const cases = products.map(p => {
        const specs = parseCaseSpecs(p.name, p.spec);
        return {
          name: p.name,
          price: p.price,
          image: p.image,
          spec: p.spec,
          info: specs.info,
          manufacturer: extractManufacturer(p.name),
          specs: {
            type: specs.type,
            formFactor: specs.formFactor,
            maxGpuLength: specs.maxGpuLength,
            maxCpuCoolerHeight: specs.maxCpuCoolerHeight,
            maxPsuLength: specs.maxPsuLength,
            expansionSlots: specs.expansionSlots,
            sidePanels: specs.sidePanels,
            frontPorts: specs.frontPorts
          }
        };
      });

      if (cases.length > 0) {
        await saveToMongoDB(cases, { ai, force });
        console.log("🎉 케이스 동기화 완료");
      }
    } catch (err) {
      console.error("❌ 동기화 실패:", err);
    }
  });
});

export default router;
