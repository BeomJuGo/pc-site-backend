// routes/syncSTORAGE.js - 가격 제외 버전 (updatePrices.js가 가격 전담)
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

/* ==================== 제조사 추출 ==================== */
function extractManufacturer(name) {
  const brands = [
    "삼성전자", "Samsung", "Western Digital", "WD", "Seagate", "씨게이트",
    "Crucial", "크루셜", "Kingston", "킹스턴", "SK하이닉스", "Toshiba",
    "Sabrent", "ADATA", "Corsair", "Intel", "Micron", "SanDisk"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "";
}

/* ==================== 스토리지 스펙 파싱 ==================== */
function parseStorageSpecs(name = "", spec = "", type = "SSD") {
  const combined = `${name} ${spec}`;
  const parts = [];

  // 용량
  const capacityMatch = combined.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  let capacity = "";
  if (capacityMatch) {
    const value = parseFloat(capacityMatch[1]);
    const unit = capacityMatch[2].toUpperCase();
    capacity = `${value}${unit}`;
    parts.push(`용량: ${capacity}`);
  }

  if (type === "SSD") {
    // 인터페이스
    if (/NVMe/i.test(combined)) parts.push("인터페이스: NVMe");
    else if (/SATA/i.test(combined)) parts.push("인터페이스: SATA");

    // 폼팩터
    if (/M\.2/i.test(combined)) parts.push("폼팩터: M.2");
    else if (/2\.5"/i.test(combined)) parts.push("폼팩터: 2.5\"");

    // PCIe Gen
    const pcieMatch = combined.match(/PCIe\s*(\d\.\d|[3-5])/i);
    if (pcieMatch) parts.push(`PCIe: Gen${pcieMatch[1]}`);

    // 읽기/쓰기 속도
    const readMatch = combined.match(/읽기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i);
    if (readMatch) parts.push(`읽기: ${readMatch[1]}MB/s`);

    const writeMatch = combined.match(/쓰기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i);
    if (writeMatch) parts.push(`쓰기: ${writeMatch[1]}MB/s`);

    // TBW
    const tbwMatch = combined.match(/TBW[:\s]*(\d+(?:,\d+)?)\s*TB/i);
    if (tbwMatch) parts.push(`TBW: ${tbwMatch[1]}TB`);

  } else if (type === "HDD") {
    // RPM
    const rpmMatch = combined.match(/(\d+)\s*RPM/i);
    if (rpmMatch) parts.push(`RPM: ${rpmMatch[1]}`);

    // 캐시
    const cacheMatch = combined.match(/캐시[:\s]*(\d+)\s*MB/i);
    if (cacheMatch) parts.push(`캐시: ${cacheMatch[1]}MB`);

    // 인터페이스
    if (/SATA/i.test(combined)) parts.push("인터페이스: SATA");
  }

  // 보증기간
  const warrantyMatch = combined.match(/(\d+)년\s*보증/i);
  if (warrantyMatch) parts.push(`보증: ${warrantyMatch[1]}년`);

  return {
    type,
    interface: type === "SSD"
      ? (/NVMe/i.test(combined) ? "NVMe" : "SATA")
      : "SATA",
    formFactor: /M\.2/i.test(combined) ? "M.2" : "2.5\"",
    capacity,
    pcieGen: type === "SSD" ? (combined.match(/PCIe\s*(\d\.\d|[3-5])/i)?.[1] || "") : "",
    readSpeed: type === "SSD" ? (combined.match(/읽기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i)?.[1] || "") : "",
    writeSpeed: type === "SSD" ? (combined.match(/쓰기[:\s]*(\d+(?:,\d+)?)\s*MB\/s/i)?.[1] || "") : "",
    tbw: type === "SSD" ? (combined.match(/TBW[:\s]*(\d+(?:,\d+)?)\s*TB/i)?.[1] || "") : "",
    rpm: type === "HDD" ? (combined.match(/(\d+)\s*RPM/i)?.[1] || "") : "",
    cache: type === "HDD" ? (combined.match(/캐시[:\s]*(\d+)\s*MB/i)?.[1] || "") : "",
    warranty: warrantyMatch?.[1] || "",
    info: parts.join(", "),
    specText: spec
  };
}

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaStorage(url, type = "SSD", maxPages = 10) {
  console.log(`🔍 다나와 ${type} 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // 불필요한 리소스 차단 (속도 향상)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        if (pageNum === 1) {
          let retries = 3;
          let loaded = false;

          while (retries > 0 && !loaded) {
            try {
              console.log(`🔄 1페이지 로딩 시도 (남은 재시도: ${retries})`);
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });
              loaded = true;
            } catch (err) {
              retries--;
              if (retries === 0) throw err;
              console.log("⏳ 재시도 대기 중...");
              await sleep(3000);
            }
          }
        } else {
          const nextBtnSelector = `a.num[page="${pageNum}"]`;
          await page.waitForSelector(nextBtnSelector, { timeout: 10000 });
          await page.click(nextBtnSelector);
          await sleep(2000);
        }

        await page.waitForSelector("ul.product_list > li.prod_item", {
          timeout: 10000,
        });

        const items = await page.evaluate(() => {
          const liList = Array.from(
            document.querySelectorAll("ul.product_list > li.prod_item")
          );
          return liList.map((li) => {
            const nameEl = li.querySelector("p.prod_name a");
            const imgEl = li.querySelector("a.thumb_link img");
            const specEl = li.querySelector("div.spec_list");

            // 가격 정보 추출
            const priceEl = li.querySelector('.price_sect a strong');
            let price = 0;
            if (priceEl) {
              const priceText = priceEl.textContent.replace(/[^0-9]/g, '');
              price = parseInt(priceText, 10) || 0;
            }

            return {
              name: nameEl?.textContent?.trim() || "",
              image: imgEl?.src || "",
              spec: specEl?.textContent?.trim() || "",
              price: price,
            };
          });
        });

        products.push(...items.filter((p) => p.name));
        console.log(`✅ 페이지 ${pageNum}: ${items.length}개 수집 완료`);

        await sleep(2000);

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);

        try {
          const screenshot = await page.screenshot({ encoding: 'base64' });
          console.log('📸 스크린샷 저장됨');
        } catch (screenshotErr) {
          console.log('⚠️ 스크린샷 저장 실패');
        }

        if (pageNum === 1) {
          break;
        }
      }
    }
  } catch (error) {
    console.error("❌ 크롤링 실패:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`🎉 총 ${products.length}개 제품 수집 완료`);
  return products;
}

/* ==================== MongoDB 저장 ==================== */
async function saveToMongoDB(storages, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "storage" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${storages.length}개`);

  let inserted = 0;
  let updated = 0;

  for (const storage of storages) {
    const old = byName.get(storage.name);

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: storage.name,
          spec: storage.spec,
        });
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
      price: storage.price || 0, // 가격 정보 추가
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      // 가격 히스토리 업데이트 (새로운 가격이 있고 기존과 다를 때)
      const today = new Date().toISOString().slice(0, 10);
      const ops = { $set: update };

      if (storage.price > 0 && storage.price !== old.price) {
        const priceHistory = old.priceHistory || [];
        const alreadyExists = priceHistory.some(p => p.date === today);

        if (!alreadyExists) {
          ops.$push = { priceHistory: { date: today, price: storage.price } };
        }
      }

      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${storage.name} (가격: ${storage.price.toLocaleString()}원)`);
    } else {
      // 신규 추가 시 가격 히스토리 초기화
      const priceHistory = [];
      if (storage.price > 0) {
        const today = new Date().toISOString().slice(0, 10);
        priceHistory.push({ date: today, price: storage.price });
      }

      await col.insertOne({
        name: storage.name,
        ...update,
        priceHistory,
      });
      inserted++;
      console.log(`🆕 신규 추가: ${storage.name} (가격: ${storage.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(storages.map((s) => s.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "storage", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개`
  );
  console.log(`💰 가격 정보도 함께 크롤링하여 저장 완료`);
}

/* ==================== Express 라우터 ==================== */
router.post("/sync-storage", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({
      message: `✅ 다나와 스토리지 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 포함)`,
    });

    setImmediate(async () => {
      try {
        console.log("\n=== 스토리지 동기화 시작 ===");

        // SSD 크롤링
        const ssdProducts = await crawlDanawaStorage(DANAWA_SSD_URL, "SSD", maxPages);
        const ssdData = ssdProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "SSD");
          return {
            name: p.name,
            image: p.image,
            info: specs.info,
            spec: specs.specText,
            specs: {
              type: specs.type,
              interface: specs.interface,
              formFactor: specs.formFactor,
              capacity: specs.capacity,
              pcieGen: specs.pcieGen,
              readSpeed: specs.readSpeed,
              writeSpeed: specs.writeSpeed,
              tbw: specs.tbw,
              warranty: specs.warranty
            }
          };
        });

        // HDD 크롤링
        const hddProducts = await crawlDanawaStorage(DANAWA_HDD_URL, "HDD", maxPages);
        const hddData = hddProducts.map(p => {
          const specs = parseStorageSpecs(p.name, p.spec, "HDD");
          return {
            name: p.name,
            image: p.image,
            info: specs.info,
            spec: specs.specText,
            specs: {
              type: specs.type,
              interface: specs.interface,
              formFactor: specs.formFactor,
              capacity: specs.capacity,
              rpm: specs.rpm,
              cache: specs.cache,
              warranty: specs.warranty
            }
          };
        });

        const allStorage = [...ssdData, ...hddData];

        if (allStorage.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(allStorage, { ai, force });
        console.log("🎉 스토리지 동기화 완료 (가격 정보 포함)");
        console.log("💰 가격 정보가 함께 크롤링되어 저장되었습니다");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-storage 실패", err);
    res.status(500).json({ error: "sync-storage 실패" });
  }
});

export default router;
