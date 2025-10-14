// routes/syncCASE.js - 가격 제외 버전 (updatePrices.js가 가격 전담)
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
          model: "gpt-4",
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
      console.log(`   ⚠️ OpenAI 재시도 ${i + 1}/3 실패:`, e.message);
      if (i < 2) await sleep(1000);
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

/* ==================== 다나와 크롤링 ==================== */
async function crawlDanawa(maxPages = 3) {
  console.log(`🔍 다나와 케이스 크롤링 시작 (최대 ${maxPages}페이지)`);
  console.log(`💡 가격은 제외 (updatePrices.js가 별도로 업데이트)`);
  
  const cases = [];
  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `${DANAWA_CASE_URL}&page=${pageNum}`;
      console.log(`\n📄 페이지 ${pageNum}/${maxPages} 크롤링 중...`);

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });

        await sleep(2000);

        const pageItems = await page.evaluate(() => {
          const items = [];
          const rows = document.querySelectorAll(".product_list .prod_item");

          rows.forEach((row) => {
            try {
              const nameEl = row.querySelector(".prod_name a");
              const imgEl = row.querySelector(".thumb_image img");
              const specEl = row.querySelector(".spec_list");

              const name = nameEl?.textContent?.trim() || "";
              const image = imgEl?.src || imgEl?.getAttribute("data-original") || "";
              const spec = specEl?.textContent?.trim() || "";

              if (name) {
                items.push({ name, image, spec });
              }
            } catch (e) {
              console.error("아이템 파싱 오류:", e);
            }
          });

          return items;
        });

        console.log(`   ✅ ${pageItems.length}개 케이스 발견`);
        cases.push(...pageItems);

      } catch (e) {
        console.error(`   ❌ 페이지 ${pageNum} 크롤링 실패:`, e.message);
      }

      await sleep(1500);
    }

  } catch (e) {
    console.error("❌ 크롤링 오류:", e);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n🎉 총 ${cases.length}개 케이스 크롤링 완료 (제품명, 스펙, 이미지만)`);
  return cases;
}

/* ==================== DB 동기화 ==================== */
async function syncCasesToDB(cases) {
  const db = getDB();
  const col = db.collection("parts");

  let inserted = 0;
  let updated = 0;
  let aiSuccess = 0;
  let aiFail = 0;

  for (const caseItem of cases) {
    try {
      const manufacturer = caseItem.name.split(" ")[0] || "Unknown";
      const specs = parseCaseSpecs(caseItem.name, caseItem.spec);

      console.log(`\n🤖 AI 한줄평 생성 중: ${caseItem.name.slice(0, 40)}...`);
      const aiResult = await fetchAiOneLiner({
        name: caseItem.name,
        spec: specs.info,
      });

      if (aiResult.review) {
        aiSuccess++;
        console.log(`   ✅ AI 성공: "${aiResult.review.slice(0, 50)}..."`);
      } else {
        aiFail++;
        console.log(`   ⚠️ AI 실패 (기본값 사용)`);
      }

      const existing = await col.findOne({
        category: "case",
        name: caseItem.name,
      });

      const update = {
        category: "case",
        manufacturer,
        info: specs.info,
        image: caseItem.image,
        specs,
        review: aiResult.review || "",
        specSummary: aiResult.specSummary || specs.info,
      };

      if (existing) {
        await col.updateOne({ _id: existing._id }, { $set: update });
        updated++;
        console.log(`🔁 업데이트: ${caseItem.name}`);
      } else {
        await col.insertOne({
          name: caseItem.name,
          ...update,
          price: 0,
          priceHistory: [],
        });
        inserted++;
        console.log(`✨ 신규 추가: ${caseItem.name} (가격: updatePrices.js에서 설정 예정)`);
      }
    } catch (e) {
      console.error(`❌ DB 저장 실패 (${caseItem.name}):`, e.message);
    }
  }

  console.log(`\n📊 동기화 완료: 신규 ${inserted}개, 업데이트 ${updated}개`);
  console.log(`🤖 AI 요약: 성공 ${aiSuccess}개, 실패 ${aiFail}개`);
  console.log(`💡 가격은 updatePrices.js로 별도 업데이트 필요`);
}

/* ==================== 라우터 ==================== */
router.post("/sync-cases", async (req, res) => {
  try {
    console.log("\n🚀 케이스 동기화 시작 (가격 제외)!");
    
    const maxPages = parseInt(req.query.maxPages) || 3;
    console.log(`📄 크롤링 페이지: ${maxPages}개`);

    const cases = await crawlDanawa(maxPages);

    if (cases.length === 0) {
      return res.status(404).json({ message: "크롤링 데이터 없음" });
    }

    await syncCasesToDB(cases);

    res.json({
      message: "✅ 케이스 동기화 완료 (제품명, 스펙, 이미지)",
      count: cases.length,
    });
  } catch (e) {
    console.error("❌ 케이스 동기화 오류:", e);
    res.status(500).json({ message: "동기화 실패", error: e.message });
  }
});

export default router;
