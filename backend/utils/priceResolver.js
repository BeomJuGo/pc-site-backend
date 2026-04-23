import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import { filterValidNaverItems, extractCriticalTokens } from "./priceValidator.js";
import logger from "./logger.js";

// 중고·리퍼·고장품 등 제외 키워드
const JUNK_KEYWORDS = ["중고", "리퍼", "refurb", "고장", "파손", "부품용", "as용", "A/S용", "수리용"];

// 부품명에서 추출할 브랜드/시리즈 지시어 (매치 요구 강화를 위해)
const BRAND_TERMS = [
  // CPU 브랜드
  "amd", "intel", "nvidia",
  "라이젠", "ryzen", "r3", "r5", "r7", "r9",
  "인텔", "코어", "core", "i3", "i5", "i7", "i9", "ultra",
  "제온", "xeon",
  // GPU
  "지포스", "geforce", "rtx", "gtx",
  "라데온", "radeon",
  // 메모리
  "ddr3", "ddr4", "ddr5",
  // 저장장치
  "nvme", "sata", "ssd", "hdd",
  // 메인보드 칩셋
  "a520", "a620", "b450", "b550", "b650", "b850", "x470", "x670", "x870",
  "h510", "h610", "h810", "b660", "b760", "b860", "z690", "z790", "z890",
];

function isJunkListing(title) {
  const lower = String(title || "").toLowerCase();
  return JUNK_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * 부품명에 포함된 브랜드/시리즈 지시어들을 반환.
 * 필터에서 "모든 브랜드 토큰 중 최소 1개가 Naver 제목에 포함" 되는 것을 강제한다.
 */
function brandTokensInName(partName) {
  const lower = String(partName || "").toLowerCase();
  return BRAND_TERMS.filter((t) => lower.includes(t));
}

function hasAnyBrandToken(title, brandTokens) {
  if (brandTokens.length === 0) return true; // 지시어 없으면 통과
  const lower = String(title || "").toLowerCase();
  return brandTokens.some((t) => lower.includes(t));
}

/**
 * 네이버쇼핑 API에서 부품의 최저가를 조회합니다.
 * 1) 모델 번호 토큰 검증 — 부품과 무관한 액세서리·번들·부분품 제외
 * 2) 중고·리퍼 키워드 필터링 — 사용자가 원하는 신품 가격만 집계
 * 3) 이상치 제거 — 최저가가 2번째 최저가의 50% 미만이면 단일 특가 outlier 간주, 제외
 * @returns {Promise<{price: number, mallCount: number}>}
 */
export async function fetchNaverPrice(partName) {
  try {
    const data = await searchNaverShopping(partName, 20, "sim");
    const items = parseNaverItems(data);
    if (!items.length) return { price: 0, mallCount: 0 };

    const tokens = extractCriticalTokens(partName);
    const brandTokens = brandTokensInName(partName);
    let validItems = tokens.length > 0 ? filterValidNaverItems(partName, items) : items;
    // 중고·리퍼·고장 제외
    validItems = validItems.filter((item) => !isJunkListing(item.title));
    // 브랜드/시리즈 지시어 중 하나는 반드시 제목에 포함돼야 함
    // (예: "1700"만 있는 제네릭 listings 제외, "라이젠/ryzen/r7" 등 포함 필요)
    validItems = validItems.filter((item) => hasAnyBrandToken(item.title, brandTokens));
    if (!validItems.length) {
      logger.warn(`fetchNaverPrice: 유효 아이템 없음 (${partName}) — 건너뜀`);
      return { price: 0, mallCount: 0 };
    }

    // 가격 오름차순 정렬 후 robust aggregation
    const sorted = validItems.slice().sort((a, b) => a.price - b.price);
    let price;
    if (sorted.length >= 3) {
      // 최저 2개 아이템이 모두 3번째보다 현저히 낮으면 두 개가 다 이상치(예: 중고 2개)일 가능성
      // 안정성을 위해 3번째 최저가와 비교:
      //  - sorted[0] >= sorted[2]*0.7 이면 sorted[0] 사용 (정상 범위)
      //  - sorted[1] >= sorted[2]*0.7 이면 sorted[1] 사용 (한 개만 이상치)
      //  - 둘 다 너무 낮으면 sorted[2] 사용 (두 개 이상치)
      // 임계값 0.8: 3번째 최저가의 80% 미만이면 이상치로 간주
      const floor = sorted[2].price * 0.8;
      if (sorted[0].price >= floor) {
        price = sorted[0].price;
      } else if (sorted[1].price >= floor) {
        logger.info(`fetchNaverPrice: 이상치1 제거 (${partName}) ${sorted[0].price} → ${sorted[1].price}`);
        price = sorted[1].price;
      } else {
        logger.info(`fetchNaverPrice: 이상치2 제거 (${partName}) ${sorted[0].price}/${sorted[1].price} → ${sorted[2].price}`);
        price = sorted[2].price;
      }
    } else {
      price = sorted[0].price;
    }
    const mallCount = new Set(validItems.map((item) => item.mallName).filter(Boolean)).size;
    return { price, mallCount };
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return { price: 0, mallCount: 0 };
  }
}
