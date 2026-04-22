import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import logger from "./logger.js";

/**
 * 네이버쇼핑 API에서 부품의 최저가를 조회합니다.
 * @returns {Promise<number>} 최저가 (조회 실패 시 0)
 */
export async function fetchNaverPrice(partName) {
  try {
    // sort=asc: 가격 오름차순으로 20개 조회 → 최저가가 관련도 하위에 있어도 확실히 포착
    const data = await searchNaverShopping(partName, 20, "asc");
    const items = parseNaverItems(data);
    if (!items.length || !items[0].price || items[0].price <= 0) return 0;
    return items[0].price;
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return 0;
  }
}
