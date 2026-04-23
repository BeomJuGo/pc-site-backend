import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import { filterValidNaverItems, extractCriticalTokens } from "./priceValidator.js";
import logger from "./logger.js";

/**
 * 네이버쇼핑 API에서 부품의 최저가를 조회합니다.
 * 모델 번호 토큰 검증을 통해 부품과 무관한 액세서리·번들·중고·부분품 listings를 제외.
 * 토큰 추출이 안 되는 이름(예: 케이스 같은 범용 상품명)은 전체 아이템 사용.
 * @returns {Promise<{price: number, mallCount: number}>} 검증된 최저가 + 판매몰 수
 */
export async function fetchNaverPrice(partName) {
  try {
    const data = await searchNaverShopping(partName, 20, "sim");
    const items = parseNaverItems(data);
    if (!items.length) return { price: 0, mallCount: 0 };

    const tokens = extractCriticalTokens(partName);
    const validItems = tokens.length > 0 ? filterValidNaverItems(partName, items) : items;
    if (!validItems.length) {
      logger.warn(`fetchNaverPrice: 토큰 일치 아이템 없음 (${partName}) — 건너뜀`);
      return { price: 0, mallCount: 0 };
    }

    const price = Math.min(...validItems.map((item) => item.price));
    const mallCount = new Set(validItems.map((item) => item.mallName).filter(Boolean)).size;
    return { price, mallCount };
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return { price: 0, mallCount: 0 };
  }
}
