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

function brandTokensInName(partName) {
  const lower = String(partName || "").toLowerCase();
  return BRAND_TERMS.filter((t) => lower.includes(t));
}

function hasAnyBrandToken(title, brandTokens) {
  if (brandTokens.length === 0) return true;
  const lower = String(title || "").toLowerCase();
  return brandTokens.some((t) => lower.includes(t));
}

/**
 * 강한 검증 3단계: 토큰 + 중고/리퍼 + 브랜드 매칭.
 * `filterValidNaverItems` (토큰만)보다 엄격하여 신품 정가 listings만 남긴다.
 * @param {string} partName
 * @param {Array<{price:number, title:string, mallName?:string}>} items
 * @returns {Array} 검증 통과한 아이템들
 */
export function applyStrictFilters(partName, items) {
  const tokens = extractCriticalTokens(partName);
  const brandTokens = brandTokensInName(partName);
  let valid = tokens.length > 0 ? filterValidNaverItems(partName, items) : items;
  valid = valid.filter((item) => !isJunkListing(item.title));
  valid = valid.filter((item) => hasAnyBrandToken(item.title, brandTokens));
  return valid;
}

/**
 * 정렬된 아이템 리스트에서 이상치 제거 후 최저가 결정.
 * 3번째 최저가의 80% 미만이면 이상치로 간주:
 *  - sorted[0] 정상 → sorted[0] 사용
 *  - sorted[0] 이상 → sorted[1] 확인, 정상이면 사용
 *  - 둘 다 이상 → sorted[2] 사용
 * @param {Array<{price:number, title?:string}>} sorted 가격 오름차순 정렬된 아이템들
 * @returns {{ price: number, outlierRemoved: 0|1|2 }}
 */
export function selectRobustLowest(sorted) {
  if (!sorted || sorted.length === 0) return { price: 0, outlierRemoved: 0 };
  if (sorted.length < 3) return { price: sorted[0].price, outlierRemoved: 0 };
  const floor = sorted[2].price * 0.8;
  if (sorted[0].price >= floor) return { price: sorted[0].price, outlierRemoved: 0 };
  if (sorted[1].price >= floor) return { price: sorted[1].price, outlierRemoved: 1 };
  return { price: sorted[2].price, outlierRemoved: 2 };
}

/**
 * 네이버쇼핑 API에서 부품의 검증된 최저가를 조회합니다.
 * 5단계 파이프라인: 토큰 매칭 → 중고/리퍼 제외 → 브랜드 매칭 → 이상치 제거
 * @returns {Promise<{price: number, mallCount: number}>}
 */
export async function fetchNaverPrice(partName) {
  try {
    const data = await searchNaverShopping(partName, 20, "sim");
    const items = parseNaverItems(data);
    if (!items.length) return { price: 0, mallCount: 0 };

    const validItems = applyStrictFilters(partName, items);
    if (!validItems.length) {
      logger.warn(`fetchNaverPrice: 유효 아이템 없음 (${partName}) — 건너뜀`);
      return { price: 0, mallCount: 0 };
    }

    const sorted = validItems.slice().sort((a, b) => a.price - b.price);
    const { price, outlierRemoved } = selectRobustLowest(sorted);
    if (outlierRemoved === 1) {
      logger.info(`fetchNaverPrice: 이상치1 제거 (${partName}) ${sorted[0].price} → ${sorted[1].price}`);
    } else if (outlierRemoved === 2) {
      logger.info(`fetchNaverPrice: 이상치2 제거 (${partName}) ${sorted[0].price}/${sorted[1].price} → ${sorted[2].price}`);
    }
    const mallCount = new Set(validItems.map((item) => item.mallName).filter(Boolean)).size;
    return { price, mallCount };
  } catch (err) {
    logger.warn(`fetchNaverPrice 실패 (${partName}): ${err.message}`);
    return { price: 0, mallCount: 0 };
  }
}
