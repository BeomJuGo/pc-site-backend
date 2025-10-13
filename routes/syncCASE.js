// scripts/syncCase.js
import axios from "axios";
import * as cheerio from "cheerio";
import { getDB, connectDB, closeDB } from "../db.js";

// 다나와 케이스 카테고리
const DANAWA_CASE_URL = "https://prod.danawa.com/list/?cate=112775";

/**
 * 케이스 스펙 파싱
 */
function parseCaseSpecs(name = "", specText = "") {
  const combined = `${name} ${specText}`.toUpperCase();

  // 케이스 타입
  let type = "미들타워";
  if (/빅타워|FULL\s*TOWER/i.test(combined)) type = "빅타워";
  else if (/미들타워|MID\s*TOWER/i.test(combined)) type = "미들타워";
  else if (/미니타워|MINI\s*TOWER/i.test(combined)) type = "미니타워";
  else if (/큐브|CUBE/i.test(combined)) type = "큐브";
  else if (/슬림|SLIM/i.test(combined)) type = "슬림";

  // 지원 메인보드 폼팩터
  const formFactors = [];
  if (/E-ATX|EATX/i.test(combined)) formFactors.push("E-ATX");
  if (/ATX/i.test(combined) && !/MINI|MICRO|M-ATX/i.test(combined)) formFactors.push("ATX");
  if (/M-ATX|MATX|MICRO\s*ATX/i.test(combined)) formFactors.push("mATX");
  if (/MINI-ITX|ITX/i.test(combined)) formFactors.push("Mini-ITX");
  if (formFactors.length === 0) formFactors.push("ATX"); // 기본값

  // 최대 GPU 길이
  const gpuMatch = combined.match(/GPU[:\s]*(\d+)\s*MM|그래픽카드[:\s]*(\d+)\s*MM|VGA[:\s]*(\d+)\s*MM/i);
  const maxGpuLength = gpuMatch ? parseInt(gpuMatch[1] || gpuMatch[2] || gpuMatch[3]) : 350;

  // 최대 쿨러 높이
  const coolerMatch = combined.match(/CPU\s*쿨러[:\s]*(\d+)\s*MM|쿨러[:\s]*(\d+)\s*MM/i);
  const maxCpuCoolerHeight = coolerMatch ? parseInt(coolerMatch[1] || coolerMatch[2]) : 160;

  // 최대 PSU 길이
  const psuMatch = combined.match(/파워[:\s]*(\d+)\s*MM|PSU[:\s]*(\d+)\s*MM/i);
  const maxPsuLength = psuMatch ? parseInt(psuMatch[1] || psuMatch[2]) : 180;

  // 확장 슬롯
  const slotMatch = combined.match(/(\d+)\s*슬롯/i);
  const expansionSlots = slotMatch ? parseInt(slotMatch[1]) : 7;

  // 측면 패널
  let sidePanels = "일반";
  if (/강화유리|TEMPERED\s*GLASS/i.test(combined)) sidePanels = "강화유리";
  else if (/아크릴|ACRYLIC/i.test(combined)) sidePanels = "아크릴";

  // 전면 포트
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

/**
 * 제조사 추출
 */
function extractManufacturer(name = "") {
  const brands = [
    "NZXT", "Fractal Design", "프랙탈디자인", "Corsair", "커세어",
    "Lian Li", "리안리", "Cooler Master", "쿨러마스터", "Phanteks", "펜텍스",
    "be quiet!", "비콰이엇", "Thermaltake", "써멀테이크", "darkFlash", "다크플래시",
    "ABKO", "앱코", "3RSYS", "잘만", "Zalman", "InWin", "인윈"
  ];

  for (const brand of brands) {
    if (name.includes(brand)) return brand;
  }
  return "기타";
}

/**
 * 다나와 케이스 크롤링
 */
async function scrapeCases() {
  const cases = [];

  try {
    console.log("🏠 다나와 케이스 페이지 크롤링 중...");
    const { data } = await axios.get(DANAWA_CASE_URL, {
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

        const specs = parseCaseSpecs(name, specText);
        const manufacturer = extractManufacturer(name);

        cases.push({
          category: "case",
          name,
          price,
          image,
          info: specs.info,
          manufacturer,
          specs: {
            type: specs.type,
            formFactor: specs.formFactor,
            maxGpuLength: specs.maxGpuLength,
            maxCpuCoolerHeight: specs.maxCpuCoolerHeight,
            maxPsuLength: specs.maxPsuLength,
            expansionSlots: specs.expansionSlots,
            sidePanels: specs.sidePanels,
            frontPorts: specs.frontPorts
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

    console.log(`✅ ${cases.length}개 케이스 수집 완료`);
  } catch (error) {
    console.error("❌ 크롤링 오류:", error.message);
  }

  return cases;
}

/**
 * DB 동기화
 */
async function syncCases() {
  await connectDB();
  const db = getDB();

  console.log("\n=== 케이스 동기화 시작 ===");
  const cases = await scrapeCases();

  if (cases.length === 0) {
    console.log("⚠️  수집된 케이스가 없습니다.");
    await closeDB();
    return;
  }

  let inserted = 0;
  let updated = 0;

  for (const caseItem of cases) {
    const existing = await db.collection("parts").findOne({
      category: "case",
      name: caseItem.name
    });

    if (existing) {
      // 가격 히스토리 업데이트
      const lastPrice = existing.priceHistory?.[existing.priceHistory.length - 1]?.price;
      if (lastPrice !== caseItem.price) {
        await db.collection("parts").updateOne(
          { _id: existing._id },
          {
            $set: {
              price: caseItem.price,
              updatedAt: new Date()
            },
            $push: {
              priceHistory: {
                date: new Date(),
                price: caseItem.price
              }
            }
          }
        );
        updated++;
      }
    } else {
      // 신규 삽입
      await db.collection("parts").insertOne(caseItem);
      inserted++;
    }
  }

  console.log(`\n📊 동기화 결과:`);
  console.log(`   - 신규 추가: ${inserted}개`);
  console.log(`   - 가격 업데이트: ${updated}개`);
  console.log(`   - 총 케이스: ${cases.length}개`);
  console.log("=== 케이스 동기화 완료 ===\n");

  await closeDB();
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  syncCases();
}

export { syncCases };
