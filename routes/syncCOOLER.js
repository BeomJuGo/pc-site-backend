// routes/syncCOOLER.js - 가격 제외 버전 (updatePrices.js가 가격 전담)
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_COOLER_URL = "https://prod.danawa.com/list/?cate=112775";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
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
    "써멀라이트", "Thermalright", "딥쿨", "Deepcool", "쿨러마스터", "Cooler Master",
    "녹투아", "Noctua", "비쿱", "Be Quiet", "커세어", "Corsair",
    "NZXT", "Arctic", "Zalman", "ID-COOLING", "Enermax", "Scythe"
  ];
  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "";
}

/* ==================== 쿨러 정보 추출 ==================== */
function extractCoolerInfo(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  const parts = [];

  // 쿨러 타입
  if (/수냉|AIO|일체형\s*수냉/i.test(combined)) {
    parts.push("수냉 쿨러");
    
    // 라디에이터 크기
    const radMatch = combined.match(/(\d{3})mm|(\d{2,3})\s*(?:mm)?/i);
    if (radMatch) {
      const size = radMatch[1] || radMatch[2];
      if (size === "120" || size === "240" || size === "280" || size === "360" || size === "420") {
        parts.push(`라디에이터: ${size}mm`);
      }
    }
  } else {
    parts.push("공랭 쿨러");
  }

  // TDP 지원
  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  if (tdpMatch) {
    parts.push(`TDP: ${tdpMatch[1]}W`);
  }

  // 높이
  const heightMatch = combined.match(/높이[:\s]*(\d{2,3})mm?|(\d{2,3})\s*mm/i);
  if (heightMatch) {
    const height = heightMatch[1] || heightMatch[2];
    if (parseInt(height) > 50 && parseInt(height) < 200) {
      parts.push(`높이: ${height}mm`);
    }
  }

  // 소켓 지원
  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1x]/i.test(combined)) sockets.push("LGA115x");
  
  if (sockets.length > 0) {
    parts.push(`소켓: ${sockets.join(", ")}`);
  }

  // RGB
  if (/ARGB|RGB/i.test(combined)) {
    parts.push("RGB");
  }

  return parts.join(", ");
}

/* ==================== 쿨러 스펙 파싱 (호환성 체크용) ==================== */
function parseCoolerSpecs(name = "", spec = "") {
  const combined = `${name} ${spec}`;
  
  // 쿨러 타입
  const isWaterCooling = /수냉|AIO|일체형\s*수냉/i.test(combined);
  
  // 소켓 지원
  const sockets = [];
  if (/AM5/i.test(combined)) sockets.push("AM5");
  if (/AM4/i.test(combined)) sockets.push("AM4");
  if (/LGA\s?1700/i.test(combined)) sockets.push("LGA1700");
  if (/LGA\s?1200/i.test(combined)) sockets.push("LGA1200");
  if (/LGA\s?115[0-1x]/i.test(combined)) sockets.push("LGA115x");
  
  // TDP
  const tdpMatch = combined.match(/TDP[:\s]*(\d{2,3})W?/i);
  const tdpW = tdpMatch ? parseInt(tdpMatch[1]) : 0;
  
  // 높이
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

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaCoolers(maxPages = 3) {
  console.log(`🔍 다나와 쿨러 크롤링 시작 (최대 ${maxPages}페이지)`);

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
              await page.goto(DANAWA_COOLER_URL, {
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

            return {
              name: nameEl?.textContent?.trim() || "",
              image: imgEl?.src || "",
              spec: specEl?.textContent?.trim() || "",
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
async function saveToMongoDB(coolers, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "cooler" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${coolers.length}개`);

  let inserted = 0;
  let updated = 0;

  for (const cooler of coolers) {
    const old = byName.get(cooler.name);
    const specs = parseCoolerSpecs(cooler.name, cooler.spec);

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: cooler.name,
          spec: cooler.spec,
        });
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
      specs: {
        type: specs.type,
        sockets: specs.sockets,
        tdpW: specs.tdpW,
        heightMm: specs.heightMm,
        specText: specs.specText
      },
      ...(ai ? { review, specSummary } : {}),
    };

    if (old) {
      // 🆕 가격 및 priceHistory 업데이트 제거
      await col.updateOne({ _id: old._id }, { $set: update });
      updated++;
      console.log(`🔁 업데이트: ${cooler.name}`);
    } else {
      // 🆕 신규 등록 시 price: 0으로 초기화
      await col.insertOne({
        name: cooler.name,
        ...update,
        price: 0,
        priceHistory: [],
      });
      inserted++;
      console.log(`🆕 신규 추가: ${cooler.name} (가격: updatePrices.js에서 설정 예정)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(coolers.map((c) => c.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "cooler", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개`
  );
  console.log(`💡 가격은 updatePrices.js로 별도 업데이트 필요`);
}

/* ==================== Express 라우터 ==================== */
router.post("/sync-cooler", async (req, res) => {
  try {
    const maxPages = parseInt(req.body?.maxPages) || 3;
    const ai = req.body?.ai !== false;
    const force = req.body?.force === true;

    res.json({
      message: `✅ 다나와 쿨러 동기화 시작 (pages=${maxPages}, ai=${ai}, 가격 제외)`,
    });

    setImmediate(async () => {
      try {
        console.log("\n=== 쿨러 동기화 시작 ===");
        const coolers = await crawlDanawaCoolers(maxPages);

        if (coolers.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(coolers, { ai, force });
        console.log("🎉 쿨러 동기화 완료 (제품명, 스펙, 이미지)");
        console.log("💡 이제 updatePrices.js를 실행하여 가격을 업데이트하세요");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-cooler 실패", err);
    res.status(500).json({ error: "sync-cooler 실패" });
  }
});

export default router;
