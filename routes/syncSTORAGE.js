// routes/syncSTORAGE.js - Puppeteer 버전 (개선)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_SSD_URL = "https://prod.danawa.com/list/?cate=112760";
const DANAWA_HDD_URL = "https://prod.danawa.com/list/?cate=112763";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
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

/* ==================== 스토리지 스펙 파싱 ==================== */
function parseStorageSpecs(name = "", specText = "", category = "SSD") {
  const combined = `${name} ${specText}`.toUpperCase();

  const type = category === "SSD" ? "SSD" : "HDD";

  let interface_ = "SATA";
  if (/NVME|NVMe/i.test(combined)) interface_ = "NVMe";
  else if (/M\.2.*SATA|M\.2\s*SATA/i.test(combined)) interface_ = "M.2 SATA";
  else if (/M\.2/i.test(combined)) interface_ = "NVMe";
  else if (/SATA/i.test(combined)) interface_ = "SATA";

  let formFactor = "2.5\"";
  if (/M\.2\s*2280/i.test(combined)) formFactor = "M.2 2280";
  else if (/M\.2\s*2260/i.test(combined)) formFactor = "M.2 2260";
  else if (/M\.2/i.test(combined)) formFactor = "M.2 2280";
  else if (/3\.5/i.test(combined)) formFactor = "3.5\"";

  const capacityMatch = combined.match(/(\d+)\s*TB|(\d+)\s*GB/i);
  let capacity = 0;
  if (capacityMatch) {
    if (capacityMatch[1]) capacity = parseInt(capacityMatch[1]) * 1000;
    else if (capacityMatch[2]) capacity = parseInt(capacityMatch[2]);
  }

  let pcieGen = 0;
  if (type === "SSD" && interface_ === "NVMe") {
    if (/PCIE\s*5|GEN\s*5/i.test(combined)) pcieGen = 5;
    else if (/PCIE\s*4|GEN\s*4/i.test(combined)) pcieGen = 4;
    else if (/PCIE\s*3|GEN\s*3/i.test(combined)) pcieGen = 3;
    else pcieGen = 3;
  }

  const readMatch = combined.match(/읽기[:\s]*(\d+)|READ[:\s]*(\d+)/i);
  const writeMatch = combined.match(/쓰기[:\s]*(\d+)|WRITE[:\s]*(\d+)/i);
  const readSpeed = readMatch ? parseInt(readMatch[1] || readMatch[2]) : 0;
  const writeSpeed = writeMatch ? parseInt(writeMatch[1] || writeMatch[2]) : 0;

  const tbwMatch = combined.match(/(\d+)\s*TBW/i);
  const tbw = tbwMatch ? parseInt(tbwMatch[1]) : 0;

  const warrantyMatch = combined.match(/(\d+)\s*년/i);
  const warranty = warrantyMatch ? parseInt(warrantyMatch[1]) : 3;

  const rpmMatch = combined.match(/(\d+)\s*RPM/i);
  const rpm = type === "HDD" && rpmMatch ? parseInt(rpmMatch[1]) : 0;

  const cacheMatch = combined.match(/(\d+)\s*MB\s*캐시/i);
  const cache = type === "HDD" && cacheMatch ? parseInt(cacheMatch[1]) : 0;

  return {
    type,
    interface: interface_,
    formFactor,
    capacity,
    pcieGen,
    readSpeed,
    writeSpeed,
    tbw,
    warranty,
    rpm,
    cache,
    info: `${formFactor} ${interface_}, ${capacity}GB${pcieGen ? ', PCIe ' + pcieGen + '.0' : ''}`.trim()
  };
}

/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name = "") {
  const brands = [
    "삼성전자", "Samsung", "WD", "Seagate", "시게이트",
    "Crucial", "Kingston", "SK hynix", "Intel", "Corsair"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "기타";
}

/* ==================== Puppeteer 크롤링 ==================== */
async function crawlDanawaStorage(url, category, maxPages = 3) {
  console.log(`🔍 ${category} 크롤링 시작 (최대 ${maxPages}페이지)`);
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
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
async function saveToMongoDB(storages, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "storage" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  let inserted = 0, updated = 0;

  for (const storage of storages) {
    const old = byName.get(storage.name);
    let review = "", specSummary = "";

    if (ai && (!old?.review || force)) {
      const aiRes = await fetchAiOneLiner({ name: storage.name, spec: storage.spec });
      review = aiRes.review || old?.review || "";
      specSummary = aiRes.specSummary || old?.specSummary || "";
    } else if (old) {
      review = old.review;
      specSummary = old.specSummary || "";
    }

    const update = {
      category: "storage",
      info: storage.info,
      price: storage.price,
      image: storage.image,
      manufacturer: storage.manufacturer,
      specs: storage.specs,
      ...(ai ? { review, specSummary } : {}),
    };

    const today = new Date().toISOString().slice(0, 10);

    if (old) {
      const ops = { $set: update };
      if (storage.price > 0 && !old.priceHistory?.some(p => p.date === today)) {
        ops.$push = { priceHistory: { date: today, price: storage.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
    } else {
      await col.insertOne({
        name: storage.name,
        ...update,
        priceHistory: storage.price > 0 ? [{ date: today, price: storage.price }] : [],
      });
      inserted++;
    }

    if (ai) await sleep(200);
  }

  console.log(`📈 삽입 ${inserted}개, 업데이트 ${updated}개`);
}

/* ==================== 라우터 ==================== */
router.post("/sync-storage", async (req, res) => {
  const maxPages = Number(req?.body?.pages) || 3;
  const ai = req?.body?.ai !== false;
  const force = !!req?.body?.force;

  res.json({ message: `✅ 스토리지 동기화 시작 (pages=${maxPages}, ai=${ai})` });

  setImmediate(async () => {
    try {
      const ssdProducts = await crawlDanawaStorage(DANAWA_SSD_URL, "SSD", maxPages);
      const hddProducts = await crawlDanawaStorage(DANAWA_HDD_URL, "HDD", maxPages);

      const allStorage = [
        ...ssdProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "SSD");
          return { ...p, ...specs, manufacturer: extractManufacturer(p.name), specs };
        }),
        ...hddProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "HDD");
          return { ...p, ...specs, manufacturer: extractManufacturer(p.name), specs };
        })
      ];

      if (allStorage.length > 0) {
        await saveToMongoDB(allStorage, { ai, force });
        console.log("🎉 스토리지 동기화 완료");
      }
    } catch (err) {
      console.error("❌ 동기화 실패:", err);
    }
  });
});

export default router;
