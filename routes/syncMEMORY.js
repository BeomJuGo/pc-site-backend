// routes/syncMEMORY.js - 다나와 메모리 크롤링 버전
import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_BASE_URL = "https://prod.danawa.com/list/?cate=112752";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정");
    return { review: "", specSummary: "" };
  }

  const prompt = `메모리(RAM) "${name}"(스펙: ${spec})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<DDR타입/속도/용량/용도>"}`;

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

/* ==================== 메모리 정보 추출 ==================== */
function extractMemoryInfo(spec = "") {
  const parts = [];
  
  // DDR 타입
  const ddrMatch = spec.match(/DDR[2-5]/i);
  if (ddrMatch) parts.push(`Type: ${ddrMatch[0].toUpperCase()}`);
  
  // 속도
  const speedMatch = spec.match(/(\d{4,5})\s*MHz/i);
  if (speedMatch) parts.push(`Speed: ${speedMatch[1]} MHz`);
  
  // 용량
  const capacityMatch = spec.match(/(\d+GB(?:\(\d+Gx\d+\))?)/i);
  if (capacityMatch) parts.push(`Capacity: ${capacityMatch[1]}`);
  
  // 램타이밍
  const timingMatch = spec.match(/CL(\d+(?:-\d+)*)/i);
  if (timingMatch) parts.push(`CL: ${timingMatch[1]}`);
  
  return parts.join(", ");
}

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaMemory(maxPages = 3) {
  console.log(`🔍 다나와 메모리 크롤링 시작 (최대 ${maxPages}페이지)`);

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
    
    // 불필요한 리소스 차단
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
              await page.goto(DANAWA_BASE_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
              });
              loaded = true;
              console.log('✅ 페이지 로딩 완료');
            } catch (e) {
              retries--;
              console.log(`⚠️ 로딩 재시도 (남은 횟수: ${retries})`);
              if (retries === 0) throw e;
              await sleep(2000);
            }
          }

          await page.waitForSelector('.main_prodlist .prod_item', {
            timeout: 30000,
          }).catch(() => {
            console.log('⚠️ 제품 리스트 로딩 지연');
          });

          await sleep(3000);

        } else {
          await page.evaluate((p) => {
            if (typeof movePage === "function") {
              movePage(p);
            }
          }, pageNum);

          await sleep(5000);

          await page.waitForSelector('.main_prodlist .prod_item', {
            timeout: 20000,
          }).catch(() => {
            console.log('⚠️ 페이지 전환 후 리스트 로딩 지연');
          });
        }

        const pageProducts = await page.evaluate(() => {
          const items = document.querySelectorAll('.main_prodlist .product_list .prod_item');
          const results = [];

          items.forEach((item) => {
            try {
              const nameEl = item.querySelector('.prod_name a');
              const name = nameEl?.textContent?.trim();

              if (!name) return;

              const priceEl = item.querySelector('.price_sect strong');
              const priceText = priceEl?.textContent?.trim() || '0';
              const price = parseInt(priceText.replace(/[^\d]/g, ''), 10) || 0;

              const imgEl = item.querySelector('img');
              const image = imgEl?.src || imgEl?.dataset?.original || '';

              const specEl = item.querySelector('.spec_list');
              const spec = specEl?.textContent
                ?.trim()
                .replace(/\s+/g, ' ')
                .replace(/더보기/g, '');

              results.push({ name, price, image, spec: spec || '' });
            } catch (e) {
              // 개별 아이템 파싱 실패는 무시
            }
          });

          return results;
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개 수집`);
        
        if (pageProducts.length === 0) {
          console.log('⚠️ 페이지에서 제품을 찾지 못함 - 크롤링 중단');
          break;
        }

        products.push(...pageProducts);

        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector('.nav_next');
          return nextBtn && !nextBtn.classList.contains('disabled');
        });

        if (!hasNext && pageNum < maxPages) {
          console.log(`⏹️ 마지막 페이지 도달 (페이지 ${pageNum})`);
          break;
        }

        await sleep(2000);

      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);
        
        try {
          const screenshot = await page.screenshot({ encoding: 'base64' });
          console.log('📸 스크린샷 저장됨 (base64, 처음 100자):', screenshot.substring(0, 100));
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
async function saveToMongoDB(memories, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "memory" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${memories.length}개`);

  let inserted = 0;
  let updated = 0;

  for (const memory of memories) {
    const old = byName.get(memory.name);
    const info = extractMemoryInfo(memory.spec);

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: memory.name,
          spec: memory.spec,
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "memory",
      info,
      price: memory.price,
      image: memory.image,
      ...(ai ? { review, specSummary } : {}),
    };

    const today = new Date().toISOString().slice(0, 10);

    if (old) {
      const ops = { $set: update };
      const hasToday = old.priceHistory?.some((p) => p.date === today);
      if (memory.price > 0 && !hasToday) {
        ops.$push = { priceHistory: { date: today, price: memory.price } };
      }
      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${memory.name} (${memory.price.toLocaleString()}원)`);
    } else {
      await col.insertOne({
        name: memory.name,
        ...update,
        priceHistory: memory.price > 0 ? [{ date: today, price: memory.price }] : [],
      });
      inserted++;
      console.log(`🆕 삽입: ${memory.name} (${memory.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200);
  }

  const currentNames = new Set(memories.map((m) => m.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "memory", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개`
  );
}

/* ==================== 라우터 ==================== */
router.post("/sync-memory", async (req, res) => {
  try {
    const maxPages = Number(req?.body?.pages) || 3;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({
      message: `✅ 다나와 메모리 동기화 시작 (pages=${maxPages}, ai=${ai})`,
    });

    setImmediate(async () => {
      try {
        const memories = await crawlDanawaMemory(maxPages);

        if (memories.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(memories, { ai, force });
        console.log("🎉 메모리 동기화 완료");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-memory 실패", err);
    res.status(500).json({ error: "sync-memory 실패" });
  }
});

export default router;
