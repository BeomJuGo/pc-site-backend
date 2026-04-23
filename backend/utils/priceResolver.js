import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import { filterValidNaverItems, extractCriticalTokens } from "./priceValidator.js";
import logger from "./logger.js";

// 중고·리퍼·고장품 등 제외 키워드
const JUNK_KEYWORDS = ["중고", "리퍼", "refurb", "고장", "파손", "부품용", "as용", "A/S용"];

function isJunkListing(title) {
  const lower = String(title || "").toLowerCase();
  return JUNK_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
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
    let validItems = tokens.length > 0 ? filterValidNaverItems(partName, items) : items;
    // 중고·리퍼·고장 제외
    validItems = validItems.filter((item) => !isJunkListing(item.title));
    if (!validItems.length) {
      logger.warn(`fetchNaverPrice: 유효 아이템 없음 (${partName}) — 건너뜀`);
      return { price: 0, mallCount: 0 };
    }

    // 가격 오름차순 정렬 후 outlier 제거
    const sorted = validItems.slice().sort((a, b) => a.price - b.price);
    let price = sorted[0].price;
    if (sorted.length >= 3 && sorted[0].price < sorted[1].price * 0.5) {
      // 최저가가 2번째 최저가의 절반 미만 → 이상치로 간주하고 2번째 값 사용
      logger.info(`fetchNaverPrice: 이상치 제거 (${partName}) ${sorted[0].price} → ${sorted[1].price}`);
      price = sorted[1].price;
    }
    const mallCount = new Set(validItems.map((item) => item.mallName).filter(Boolean)).size;
    return { price, mallCount };
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return { price: 0, mallCount: 0 };
  }
}
