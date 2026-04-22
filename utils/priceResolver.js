import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import logger from "./logger.js";

/**
 * 네이버쇼핑 API에서 부품의 최저가를 조회합니다.
 * @returns {Promise<number>} 최저가 (조회 실패 시 0)
 */
export async function fetchNaverPrice(partName) {
  try {
    const data = await searchNaverShopping(partName, 5);
    const items = parseNaverItems(data);
    if (!items.length || !items[0].price || items[0].price <= 0) return 0;
    return items[0].price;
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return 0;
  }
}
