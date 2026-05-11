const EXCLUDED_MARKERS_RE = /병행수입|해외직구|해외구매|리퍼|refurb|중고/i;

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, "").trim();
}

export function extractCriticalTokens(partName) {
  const normalized = partName.toLowerCase();
  const tokens = new Set();

  // DDR memory type+speed: ddr5-5600, ddr4-3200
  (normalized.match(/\bddr[2-5]-\d{3,5}\b/g) || []).forEach((t) => tokens.add(t));

  // NVIDIA GPU: rtx 4090, rtx 3060 ti, rtx3060ti
  (normalized.match(/\brtx\s*\d{4}(?:\s*(?:ti|super))?\b/g) || [])
    .forEach((t) => tokens.add(t.replace(/\s+/g, " ").trim()));

  // AMD GPU: rx 6600 xt, rx 7900 xtx, rx6600xt
  (normalized.match(/\brx\s*\d{3,4}(?:\s*(?:xtx|xt|gre))?\b/g) || [])
    .forEach((t) => tokens.add(t.replace(/\s+/g, " ").trim()));

  // Chipset / socket platform: b650, h610, z790, x570, a320
  (normalized.match(/\b[bzhxpa]\d{3}[a-z0-9]*\b/g) || []).forEach((t) => tokens.add(t));

  // CPU compound model: i9-14900k, e5-2640v3, w7-3465x
  (normalized.match(/\b[a-z]\d+-\d+[a-z0-9]*\b/g) || []).forEach((t) => tokens.add(t));

  // Standalone 4+ digit model numbers: 3950x, 4090, 14900k
  (normalized.match(/\b\d{4,}[a-z]{0,3}\b/g) || []).forEach((t) => tokens.add(t));

  // Storage/SSD model numbers: BX500, MX500, SN770, P3+ etc. (영문1~4자 + 숫자3자리+)
  (normalized.match(/\b[a-z]{1,4}\d{3}[a-z0-9]{0,5}\b/g) || [])
    .filter(t => !["ddr3","ddr4","ddr5","sata","nvme","pcie","gddr"].includes(t))
    .forEach(t => tokens.add(t));

  return [...tokens];
}

function isValidResultItem(targetName, resultTitle) {
  const cleanTitle = stripHtml(resultTitle);
  if (EXCLUDED_MARKERS_RE.test(cleanTitle)) return false;

  const tokens = extractCriticalTokens(targetName);
  if (tokens.length === 0) return true;

  const normalizedTitle = cleanTitle.toLowerCase();
  return tokens.every((token) => normalizedTitle.includes(token));
}

/**
 * 토큰 매칭 및 병행수입/중고 제외 후 유효 아이템 반환
 */
export function filterValidNaverItems(targetName, naverItems) {
  return naverItems.filter((item) => isValidResultItem(targetName, item.title || ""));
}

/**
 * @param {string} targetName - 검증 기준이 되는 부품 이름 (DB 등록 기준)
 * @param {Array} naverItems - 네이버 API items 배열 (raw: lprice+title, or parsed: price+title)
 * @param {number|null} referencePrice - 기준 가격 (가격 범위 이탈 체크용, 없으면 null)
 * @param {number} toleranceFactor - 허용 배율 (기본 1.5 = 기준가의 2/3 ~ 1.5배)
 * @returns {{ valid: boolean, price: number|null, reason: string|null, matchedCount: number, totalCount: number }}
 */
export function validateNaverPrice(targetName, naverItems, referencePrice = null, toleranceFactor = 1.5) {
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
