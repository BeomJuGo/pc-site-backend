// routes/syncCOOLER.js - Puppeteer 버전 (개선)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_COOLER_URL = "https://prod.danawa.com/list/?cate=11236855";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `쿨러 "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<타입/높이/TDP/소켓>"}`;

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

/* ==================== 쿨러 스펙 파싱 ==================== */
function parseCoolerSpecs(name = "", specText = "") {
  const combined = `${name} ${specText}`.toUpperCase();

  let type = "공랭";
  if (/수랭|LIQUID|WATER|AIO/i.test(combined)) type = "수랭";

  let coolerType = "타워형";
  if (type === "수랭") {
    if (/240MM|280MM|360MM|420MM/i.test(combined)) {
      coolerType = "일체형수랭";
    }
  } else {
    if (/로우프로파일|LOW\s*PROFILE/i.test(combined)) coolerType = "로우프로파일";
    else if (/타워|TOWER/i.test(combined)) coolerType = "타워형";
    else if (/탑플로우|TOP\s*FLOW/i.test(combined)) coolerType = "탑플로우";
  }

  const heightMatch = combined.match(/높이[:\s]*(\d+)\s*MM|HEIGHT[:\s]*(\d+)\s*MM/i);
  const height = heightMatch ? parseInt(heightMatch[1] || heightMatch[2]) : 
                 (coolerType === "로우프로파일" ? 65 : 
                  type === "수랭" ? 0 : 155);

  const tdpMatch = combined.match(/(\d+)\s*W\s*TDP|TDP[:\s]*(\d+)\s*W/i);
  const tdpRating = tdpMatch ? parseInt(tdpMatch[1] || tdpMatch[2]) : 
                    (type === "수랭" ? 250 : 180);

  const fanMatch = combined.match(/(\d+)\s*MM\s*팬|(\d+)\s*MM\s*FAN/i);
  const fanSize = fanMatch ? parseInt(fanMatch[1] || fanMatch[2]) : 
                  (type === "수랭" ? 120 : 120);

  const fanCountMatch = combined.match(/(\d+)\s*팬|(\d+)FAN/i);
  const fanCount = fanCountMatch ? parseInt(fanCountMatch[1] || fanCountMatch[2]) : 1;

  const socketSupport = [];
  if (/AM5/i.test(combined)) socketSupport.push("AM5");
  if (/AM4/i.test(combined)) socketSupport.push("AM4");
  if (/AM3/i.test(combined)) socketSupport.push("AM3");
  if (/TR4|TRX4/i.test(combined)) socketSupport.push("TRX4");
  if (/LGA\s*1700|LGA1700/i.test(combined)) socketSupport.push("LGA1700");
  if (/LGA\s*1200|LGA1200/i.test(combined)) socketSupport.push("LGA1200");
  if (/LGA\s*1151|LGA1151/i.test(combined)) socketSupport.push("LGA1151");

  if (socketSupport.length === 0) {
    socketSupport.push("AM4", "LGA1700", "LGA1200");
  }

  const noiseMatch = combined.match(/(\d+(?:\.\d+)?)\s*DBA/i);
  const noise = noiseMatch ? `${noiseMatch[1]} dBA` : "";

  const rpmMatch = combined.match(/(\d+)\s*[-~]\s*(\d+)\s*RPM/i);
  const rpm = rpmMatch ? `${rpmMatch[1]}-${rpmMatch[2]} RPM` : "";

  return {
    type,
    coolerType,
    height,
    tdpRating,
    fanSize,
    fanCount,
    socketSupport: [...new Set(socketSupport)],
    noise,
    rpm,
    info: `${type}, ${coolerType}${height > 0 ? ', ' + height + 'mm' : ''}`.trim()
  };
}

/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name = "") {
  const brands = [
    "Noctua", "be quiet!", "Cooler Master", "Deepcool", "Arctic",
    "Thermalright", "ID-COOLING", "NZXT", "Corsair", "Thermaltake", "Zalman"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "기타";
}

/* ==================== Puppeteer 크롤링 ==================== */
async function crawlDanawaCoolers(maxPages = 3) {
  console.log(`🔍 쿨러 크롤링 시작 (최대 ${maxPages}페이지)`);
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
          await page.goto(DANAWA_COOLER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
async function saveToMongoDB(coolers, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cooler" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0;

  for (const cooler of coolers) {
    const old = byName.get(cooler.name);
    let review = "", specSummary = "";

    if (ai && (!old?.review || force)) {
      const aiRes = await fetchAiOneLiner({ name: cooler.name, spec: cooler.spec });
      review = aiRes.review || old?.review || "";
      specSummary = aiRes.specSummary || old?.specSummary || "";
    } else if (old) {
      review = old.review;
      specSummary = old.specSummary || "";
    }

    const update = {
      category: "cooler",
      info: cooler.info,
      price: cooler.price,
      image: cooler.image,
      manufacturer: cooler.manufacturer,
      specs: cooler.specs,
      ...(ai ? { review, specSummary } : {}),
    };

    const today = new Date().toISOString().slice(0, 10);

    if (old) {
      const ops = { $set: update };
      if (cooler.price > 0 && !old.priceHistory?.some(p => p.date === today)) {
        ops.$push = { priceHistory: { date: today, price: cooler.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
    } else {
      await col.insertOne({
        name: cooler.name,
        ...update,
        priceHistory: cooler.price > 0 ? [{ date: today, price: cooler.price }] : [],
      });
      inserted++;
    }

    if (ai) await sleep(200);
  }

  console.log(`📈 삽입 ${inserted}개, 업데이트 ${updated}개`);
}

/* ==================== 라우터 ==================== */
router.post("/sync-cooler", async (req, res) => {
  const maxPages = Number(req?.body?.pages) || 3;
  const ai = req?.body?.ai !== false;
  const force = !!req?.body?.force;

  res.json({ message: `✅ 쿨러 동기화 시작 (pages=${maxPages}, ai=${ai})` });

  setImmediate(async () => {
    try {
      const products = await crawlDanawaCoolers(maxPages);

      const coolers = products.map(p => {
        const specs = parseCoolerSpecs(p.name, p.spec);
        return {
          name: p.name,
          price: p.price,
          image: p.image,
          spec: p.spec,
          info: specs.info,
          manufacturer: extractManufacturer(p.name),
          specs: {
            type: specs.type,
            coolerType: specs.coolerType,
            height: specs.height,
            tdpRating: specs.tdpRating,
            fanSize: specs.fanSize,
            fanCount: specs.fanCount,
            socketSupport: specs.socketSupport,
            noise: specs.noise,
            rpm: specs.rpm
          }
        };
      });

      if (coolers.length > 0) {
        await saveToMongoDB(coolers, { ai, force });
        console.log("🎉 쿨러 동기화 완료");
      }
    } catch (err) {
      console.error("❌ 동기화 실패:", err);
    }
  });
});

export default router;
