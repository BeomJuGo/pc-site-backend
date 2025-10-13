// routes/syncPSU.js - Express Router 버전
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const router = express.Router();

// 다나와 파워 카테고리
const DANAWA_PSU_URL = "https://prod.danawa.com/list/?cate=112777";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * PSU 스펙 파싱
 */
function parsePSUSpecs(name = "", specText = "") {
  const combined = `${name} ${specText}`.toUpperCase();

  // 출력(W)
  const wattageMatch = combined.match(/(\d+)\s*W(?!\w)/i);
  const wattage = wattageMatch ? parseInt(wattageMatch[1]) : 0;

  // 효율 등급
  let efficiency = "";
  if (/80PLUS\s*TITANIUM|TITANIUM/i.test(combined)) efficiency = "80Plus Titanium";
  else if (/80PLUS\s*PLATINUM|PLATINUM/i.test(combined)) efficiency = "80Plus Platinum";
  else if (/80PLUS\s*GOLD|GOLD/i.test(combined)) efficiency = "80Plus Gold";
  else if (/80PLUS\s*SILVER|SILVER/i.test(combined)) efficiency = "80Plus Silver";
  else if (/80PLUS\s*BRONZE|BRONZE/i.test(combined)) efficiency = "80Plus Bronze";
  else if (/80PLUS\s*WHITE|WHITE/i.test(combined)) efficiency = "80Plus White";
  else if (/80PLUS/i.test(combined)) efficiency = "80Plus";

  // 모듈러 타입
  let modular = "논모듈러";
  if (/풀모듈러|FULL\s*MODULAR/i.test(combined)) modular = "풀모듈러";
  else if (/세미모듈러|SEMI\s*MODULAR/i.test(combined)) modular = "세미모듈러";

  // 폼팩터
  let formFactor = "ATX";
  if (/SFX-L/i.test(combined)) formFactor = "SFX-L";
  else if (/SFX/i.test(combined)) formFactor = "SFX";
  else if (/TFX/i.test(combined)) formFactor = "TFX";

  // PFC
  const pfc = /ACTIVE\s*PFC/i.test(combined) ? "Active PFC" : "";

  // 쿨링
  const fanMatch = combined.match(/(\d+)\s*MM/i);
  const cooling = fanMatch ? `${fanMatch[1]}mm 팬` : "";

  return {
    wattage,
    efficiency,
    modular,
    formFactor,
    pfc,
    cooling,
    info: `${wattage}W, ${efficiency}, ${modular}, ${formFactor}`.trim()
  };
}

/**
 * 제조사 추출
 */
function extractManufacturer(name = "") {
  const brands = [
    "마이크로닉스", "시소닉", "Seasonic", "SuperFlower", "슈퍼플라워",
    "Corsair", "커세어", "EVGA", "Thermaltake", "써멀테이크",
    "Cooler Master", "쿨러마스터", "be quiet!", "FSP", "전해",
    "Antec", "안텍", "NZXT", "SilverStone", "실버스톤"
  ];

  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "기타";
}

/**
 * 다나와 PSU 크롤링
 */
async function scrapePSUs() {
  const psus = [];

  try {
    console.log("🔌 다나와 PSU 페이지 크롤링 중...");
    const { data } = await axios.get(DANAWA_PSU_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    const $ = cheerio.load(data);

    $(".product_list .prod_item").each((i, el) => {
      try {
        const $el = $(el);
        const name = $el.find(".prod_name a").text().trim();
        if (!name) return;

        const priceText = $el.find(".price_sect .price").text().trim();
        const price = parseInt(priceText.replace(/[^0-9]/g, "")) || 0;
        if (price === 0) return;

        const image = $el.find(".thumb_image img").attr("src") || "";
        const specText = $el.find(".spec_list").text().trim();

        const specs = parsePSUSpecs(name, specText);
        const manufacturer = extractManufacturer(name);

        psus.push({
          category: "psu",
          name,
          price,
          image,
          info: specs.info,
          manufacturer,
          specs: {
            wattage: specs.wattage,
            efficiency: specs.efficiency,
            modular: specs.modular,
            formFactor: specs.formFactor,
            pfc: specs.pfc,
            cooling: specs.cooling
          },
          priceHistory: [{
            date: new Date(),
            price: price
          }],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } catch (err) {
        console.error("파싱 오류:", err.message);
      }
    });

    console.log(`✅ ${psus.length}개 PSU 수집 완료`);
  } catch (error) {
    console.error("❌ 크롤링 오류:", error.message);
  }

  return psus;
}

/**
 * DB 동기화
 */
async function syncPSUsToDB(psus) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  let inserted = 0;
  let updated = 0;

  for (const psu of psus) {
    const existing = await col.findOne({
      category: "psu",
      name: psu.name
    });

    const update = {
      category: "psu",
      info: psu.info,
      price: psu.price,
      image: psu.image,
      manufacturer: psu.manufacturer,
      specs: psu.specs
    };

    if (existing) {
      const ops = { $set: update };
      const hasToday = existing.priceHistory?.some(p => p.date === today);
      if (psu.price > 0 && !hasToday) {
        ops.$push = { priceHistory: { date: today, price: psu.price } };
      }
      await col.updateOne({ _id: existing._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${psu.name}`);
    } else {
      await col.insertOne({
        name: psu.name,
        ...update,
        priceHistory: psu.price > 0 ? [{ date: today, price: psu.price }] : [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      inserted++;
      console.log(`🆕 삽입: ${psu.name}`);
    }

    await sleep(100);
  }

  console.log(`\n📊 동기화 결과: 삽입 ${inserted}개, 업데이트 ${updated}개`);
  return { inserted, updated };
}

/* ==================== 라우터 ==================== */
router.post("/sync-psu", async (req, res) => {
  try {
    res.json({ message: "✅ PSU 동기화 시작" });

    setImmediate(async () => {
      try {
        console.log("\n=== PSU 동기화 시작 ===");
        const psus = await scrapePSUs();

        if (psus.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await syncPSUsToDB(psus);
        console.log("🎉 PSU 동기화 완료");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-psu 실패", err);
    res.status(500).json({ error: "sync-psu 실패" });
  }
});

export default router;
