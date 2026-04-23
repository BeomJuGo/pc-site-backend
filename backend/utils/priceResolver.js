import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import logger from "./logger.js";

/**
 * 네이버쇼핑 API에서 부품의 최저가를 조회합니다.
 * @returns {Promise<number>} 최저가 (조회 실패 시 0)
 */
export async function fetchNaverPrice(partName) {
  try {
    // sort=sim: 관련도순 20개 조회 후 최저가 + 판매 몰 수 반환
    const data = await searchNaverShopping(partName, 20, "sim");
    const items = parseNaverItems(data);
    if (!items.length) return { price: 0, mallCount: 0 };
    const price = Math.min(...items.map((item) => item.price));
    const mallCount = new Set(items.map((item) => item.mallName).filter(Boolean)).size;
    return { price, mallCount };
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return { price: 0, mallCount: 0 };
  }
}
