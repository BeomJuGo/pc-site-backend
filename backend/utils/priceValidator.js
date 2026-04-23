function stripHtml(text) {
  return text.replace(/<[^>]*>/g, "").trim();
}

export function extractCriticalTokens(partName) {
  const normalized = partName.toLowerCase();
  const tokens = new Set();

  // Compound model numbers: w7-3465x, i9-14900k, e5-2640v3
  const compound = normalized.match(/\b[a-z]\d+-\d+[a-z0-9]*\b/g) || [];
  compound.forEach((t) => tokens.add(t));

  // Standalone numeric model numbers with optional letter suffix: 3950x, 3600, 4090, 14900k
  const numeric = normalized.match(/\b\d{4,}[a-z]{0,3}\b/g) || [];
  numeric.forEach((t) => tokens.add(t));

  return [...tokens];
}

function isValidResultItem(targetName, resultTitle) {
  const tokens = extractCriticalTokens(targetName);
  if (tokens.length === 0) return true;

  const normalizedTitle = stripHtml(resultTitle).toLowerCase();
  return tokens.every((token) => normalizedTitle.includes(token));
}

/**
 * 토큰 매칭을 통과한 아이템만 반환. 토큰이 없으면 전체 반환.
 */
export function filterValidNaverItems(targetName, naverItems) {
  const tokens = extractCriticalTokens(targetName);
  if (tokens.length === 0) return naverItems;
  return naverItems.filter((item) => isValidResultItem(targetName, item.title || ""));
}

/**
 * @param {string} targetName - 검증 기준이 되는 부품 이름 (DB 등록 기준)
 * @param {Array} naverItems - 네이버 API items 배열 (raw: lprice+title, or parsed: price+title)
 * @param {number|null} referencePrice - 기준 가격 (가격 범위 이탈 체크용, 없으면 null)
 * @param {number} toleranceFactor - 허용 배율 (기본 3.0 = 기준가의 1/3 ~ 3배)
 * @returns {{ valid: boolean, price: number|null, reason: string|null, matchedCount: number, totalCount: number }}
 */
export function validateNaverPrice(targetName, naverItems, referencePrice = null, toleranceFactor = 3.0) {
  const totalCount = naverItems.length;

  const validItems = naverItems.filter((item) => isValidResultItem(targetName, item.title || ""));
  const matchedCount = validItems.length;

  if (matchedCount === 0) {
    return {
      valid: false,
      price: null,
      reason: "일치하는 제품 없음: 검색 결과가 다른 제품을 가져왔습니다",
      matchedCount,
      totalCount,
    };
  }

  const prices = validItems
    .map((item) => parseInt(item.lprice || item.price || 0))
    .filter((p) => p > 0);

  if (prices.length === 0) {
    return {
      valid: false,
      price: null,
      reason: "유효한 가격 없음",
      matchedCount,
      totalCount,
    };
  }

  const lowestPrice = Math.min(...prices);

  if (referencePrice != null && referencePrice > 0) {
    const ratio = lowestPrice / referencePrice;
    if (ratio < 1 / toleranceFactor || ratio > toleranceFactor) {
      return {
        valid: false,
        price: lowestPrice,
        reason: `가격 범위 초과: 기준가 ${referencePrice.toLocaleString()}원 대비 ${lowestPrice.toLocaleString()}원 (비율 ${ratio.toFixed(2)})`,
        matchedCount,
        totalCount,
      };
    }
  }

  return {
    valid: true,
    price: lowestPrice,
    reason: null,
    matchedCount,
    totalCount,
  };
}
