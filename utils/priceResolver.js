import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import logger from "./logger.js";

/**
 * 네이버쇼핑 API에서 부품의 최저가를 조회합니다.
 * @returns {Promise<number>} 최저가 (조회 실패 시 0)
 */
export async function fetchNaverPrice(partName) {
  try {
    // sort=sim: 관련도순 20개 조회 후 그 중 최저가 선택
    // (sort=asc는 스팸/광고 1원짜리 상품이 상위에 올라와 잘못된 가격을 반환함)
    const data = await searchNaverShopping(partName, 20, "sim");
    const items = parseNaverItems(data);
    // 1,000원 미만은 스팸 상품으로 간주하고 제외
    const valid = items.filter((item) => item.price >= 1000);
    if (!valid.length) return 0;
    return Math.min(...valid.map((item) => item.price));
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return 0;
  }
}
