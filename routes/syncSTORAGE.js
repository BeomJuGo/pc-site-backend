// routes/syncSTORAGE.js - Express Router 버전
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB } from "../db.js";

const router = express.Router();

// 다나와 SSD/HDD 카테고리
const DANAWA_SSD_URL = "https://prod.danawa.com/list/?cate=112760"; // SSD
const DANAWA_HDD_URL = "https://prod.danawa.com/list/?cate=112763"; // HDD
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 스토리지 스펙 파싱
 */
function parseStorageSpecs(name = "", specText = "", category = "SSD") {
  const combined = `${name} ${specText}`.toUpperCase();

  // 타입
  const type = category === "SSD" ? "SSD" : "HDD";

  // 인터페이스
  let interface_ = "SATA";
  if (/NVME|NVMe/i.test(combined)) interface_ = "NVMe";
  else if (/M\.2.*SATA|M\.2\s*SATA/i.test(combined)) interface_ = "M.2 SATA";
  else if (/M\.2/i.test(combined)) interface_ = "NVMe"; // M.2는 대부분 NVMe
  else if (/SATA/i.test(combined)) interface_ = "SATA";
  else if (/SAS/i.test(combined)) interface_ = "SAS";

  // 폼팩터
  let formFactor = "2.5\"";
  if (/M\.2\s*2280/i.test(combined)) formFactor = "M.2 2280";
  else if (/M\.2\s*2260/i.test(combined)) formFactor = "M.2 2260";
  else if (/M\.2\s*2242/i.test(combined)) formFactor = "M.2 2242";
  else if (/M\.2\s*22110/i.test(combined)) formFactor = "M.2 22110";
  else if (/M\.2/i.test(combined)) formFactor = "M.2 2280"; // 기본 M.2
  else if (/3\.5|3\.5인치|3\.5INCH/i.test(combined)) formFactor = "3.5\"";
  else if (/2\.5|2\.5인치|2\.5INCH/i.test(combined)) formFactor = "2.5\"";

  // 용량 (GB)
  const capacityMatch = combined.match(/(\d+)\s*TB|(\d+)\s*GB/i);
  let capacity = 0;
  if (capacityMatch) {
    if (capacityMatch[1]) {
      capacity = parseInt(capacityMatch[1]) * 1000; // TB -> GB
    } else if (capacityMatch[2]) {
      capacity = parseInt(capacityMatch[2]);
    }
  }

  // PCIe 세대 (SSD만)
  let pcieGen = 0;
  if (type === "SSD" && interface_ === "NVMe") {
    if (/PCIE\s*5\.0|GEN\s*5|PCIe\s*5/i.test(combined)) pcieGen = 5;
    else if (/PCIE\s*4\.0|GEN\s*4|PCIe\s*4/i.test(combined)) pcieGen = 4;
    else if (/PCIE\s*3\.0|GEN\s*3|PCIe\s*3/i.test(combined)) pcieGen = 3;
    else pcieGen = 3; // 기본값
  }

  // 읽기/쓰기 속도 (MB/s)
  const readMatch = combined.match(/읽기[:\s]*(\d+)\s*MB\/S|READ[:\s]*(\d+)\s*MB\/S/i);
  const writeMatch = combined.match(/쓰기[:\s]*(\d+)\s*MB\/S|WRITE[:\s]*(\d+)\s*MB\/S/i);
  const readSpeed = readMatch ? parseInt(readMatch[1] || readMatch[2]) : 0;
  const writeSpeed = writeMatch ? parseInt(writeMatch[1] || writeMatch[2]) : 0;

  // TBW (총 쓰기 용량, TB)
  const tbwMatch = combined.match(/(\d+)\s*TBW/i);
  const tbw = tbwMatch ? parseInt(tbwMatch[1]) : 0;

  // 보증기간 (년)
  const warrantyMatch = combined.match(/(\d+)\s*년\s*보증|(\d+)\s*YEAR/i);
  const warranty = warrantyMatch ? parseInt(warrantyMatch[1] || warrantyMatch[2]) : 3;

  // RPM (HDD만)
  const rpmMatch = combined.match(/(\d+)\s*RPM/i);
  const rpm = type === "HDD" && rpmMatch ? parseInt(rpmMatch[1]) : 0;

  // 캐시 (HDD)
  const cacheMatch = combined.match(/(\d+)\s*MB\s*캐시|(\d+)\s*MB\s*CACHE/i);
  const cache = type === "HDD" && cacheMatch ? parseInt(cacheMatch[1] || cacheMatch[2]) : 0;

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

/**
 * 제조사 추출
 */
function extractManufacturer(name = "") {
  const brands = [
    "삼성전자", "Samsung", "Western Digital", "WD", "Seagate", "시게이트",
    "Crucial", "크루셜", "Kingston", "킹스턴", "SK hynix", "SK하이닉스",
    "Micron", "마이크론", "ADATA", "에이데이터", "Transcend", "트랜센드",
    "Intel", "인텔", "Corsair", "커세어", "Sabrent", "Toshiba", "도시바",
    "KIOXIA", "키옥시아", "Lexar", "렉사"
  ];

  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "기타";
}

/**
 * 다나와 스토리지 크롤링
 */
async function scrapeStorages() {
  const storages = [];

  // SSD 크롤링
  try {
    console.log("💾 다나와 SSD 페이지 크롤링 중...");
    const { data } = await axios.get(DANAWA_SSD_URL, {
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

        const specs = parseStorageSpecs(name, specText, "SSD");
        const manufacturer = extractManufacturer(name);

        storages.push({
          category: "storage",
          name,
          price,
          image,
          info: specs.info,
          manufacturer,
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
          },
          priceHistory: [{
            date: new Date(),
            price: price
          }],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } catch (err) {
        console.error("SSD 파싱 오류:", err.message);
      }
    });

    console.log(`✅ ${storages.length}개 SSD 수집 완료`);
  } catch (error) {
    console.error("❌ SSD 크롤링 오류:", error.message);
  }

  // HDD 크롤링
  try {
    console.log("💿 다나와 HDD 페이지 크롤링 중...");
    const { data } = await axios.get(DANAWA_HDD_URL, {
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

        const specs = parseStorageSpecs(name, specText, "HDD");
        const manufacturer = extractManufacturer(name);

        storages.push({
          category: "storage",
          name,
          price,
          image,
          info: specs.info,
          manufacturer,
          specs: {
            type: specs.type,
            interface: specs.interface,
            formFactor: specs.formFactor,
            capacity: specs.capacity,
            rpm: specs.rpm,
            cache: specs.cache,
            warranty: specs.warranty
          },
          priceHistory: [{
            date: new Date(),
            price: price
          }],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } catch (err) {
        console.error("HDD 파싱 오류:", err.message);
      }
    });

    console.log(`✅ 총 ${storages.length}개 스토리지(SSD+HDD) 수집 완료`);
  } catch (error) {
    console.error("❌ HDD 크롤링 오류:", error.message);
  }

  return storages;
}

/**
 * DB 동기화
 */
async function syncStoragesToDB(storages) {
  const db = getDB();
  const col = db.collection("parts");
  const today = new Date().toISOString().slice(0, 10);

  let inserted = 0;
  let updated = 0;

  for (const storage of storages) {
    const existing = await col.findOne({
      category: "storage",
      name: storage.name
    });

    const update = {
      category: "storage",
      info: storage.info,
      price: storage.price,
      image: storage.image,
      manufacturer: storage.manufacturer,
      specs: storage.specs
    };

    if (existing) {
      const ops = { $set: update };
      const hasToday = existing.priceHistory?.some(p => p.date === today);
      if (storage.price > 0 && !hasToday) {
        ops.$push = { priceHistory: { date: today, price: storage.price } };
      }
      await col.updateOne({ _id: existing._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${storage.name}`);
    } else {
      await col.insertOne({
        name: storage.name,
        ...update,
        priceHistory: storage.price > 0 ? [{ date: today, price: storage.price }] : [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      inserted++;
      console.log(`🆕 삽입: ${storage.name}`);
    }

    await sleep(100);
  }

  console.log(`\n📊 동기화 결과: 삽입 ${inserted}개, 업데이트 ${updated}개`);
  return { inserted, updated };
}

/* ==================== 라우터 ==================== */
router.post("/sync-storage", async (req, res) => {
  try {
    res.json({ message: "✅ 스토리지 동기화 시작" });

    setImmediate(async () => {
      try {
        console.log("\n=== 스토리지 동기화 시작 ===");
        const storages = await scrapeStorages();

        if (storages.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await syncStoragesToDB(storages);
        console.log("🎉 스토리지 동기화 완료");
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
