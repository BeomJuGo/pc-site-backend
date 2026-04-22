import logger from "./logger.js";

const SEARCH_TREND_URL = "https://openapi.naver.com/v1/datalab/search";

// 카테고리별 브랜드 검색어 그룹
// 검색어트렌드 API: 1회 요청당 최대 5개 그룹 비교
const BRAND_KEYWORD_GROUPS = {
  memory: [
    { groupName: "삼성", keywords: ["삼성 메모리", "삼성 램", "samsung ddr"] },
    { groupName: "SK하이닉스", keywords: ["sk하이닉스 메모리", "하이닉스 램", "hynix 램"] },
    { groupName: "마이크론", keywords: ["마이크론 메모리", "크루셜 램", "crucial 메모리"] },
    { groupName: "커세어", keywords: ["커세어 메모리", "corsair 램"] },
    { groupName: "G.SKILL", keywords: ["지스킬 메모리", "g.skill 램", "gskill"] },
  ],
  storage: [
    { groupName: "삼성", keywords: ["삼성 SSD", "samsung ssd"] },
    { groupName: "WD", keywords: ["웨스턴디지털 SSD", "wd ssd", "wd 하드"] },
    { groupName: "씨게이트", keywords: ["씨게이트 SSD", "seagate ssd", "씨게이트 하드"] },
    { groupName: "SK하이닉스", keywords: ["sk하이닉스 ssd", "하이닉스 ssd"] },
    { groupName: "마이크론", keywords: ["마이크론 ssd", "크루셜 ssd", "crucial ssd"] },
  ],
  motherboard: [
    { groupName: "ASUS", keywords: ["에이수스 메인보드", "asus 메인보드", "asus rog"] },
    { groupName: "MSI", keywords: ["msi 메인보드", "엠에스아이 메인보드"] },
    { groupName: "기가바이트", keywords: ["기가바이트 메인보드", "gigabyte 메인보드"] },
    { groupName: "ASRock", keywords: ["애즈락 메인보드", "asrock 메인보드"] },
  ],
  psu: [
    { groupName: "시소닉", keywords: ["시소닉 파워", "seasonic 파워"] },
    { groupName: "커세어", keywords: ["커세어 파워", "corsair 파워"] },
    { groupName: "FSP", keywords: ["fsp 파워", "에프에스피 파워"] },
    { groupName: "마이크로닉스", keywords: ["마이크로닉스 파워"] },
    { groupName: "안텍", keywords: ["안텍 파워", "antec 파워"] },
  ],
  cooler: [
    { groupName: "쿨러마스터", keywords: ["쿨러마스터 쿨러", "cooler master cpu쿨러"] },
    { groupName: "딥쿨", keywords: ["딥쿨 쿨러", "deepcool 쿨러"] },
    { groupName: "ID쿨링", keywords: ["id쿨링", "id-cooling 쿨러"] },
    { groupName: "녹투아", keywords: ["녹투아 쿨러", "noctua 쿨러"] },
    { groupName: "아틱", keywords: ["아틱 쿨러", "arctic 쿨러"] },
  ],
  case: [
    { groupName: "3RSYS", keywords: ["3rsys 케이스", "쓰리알 케이스"] },
    { groupName: "마이크로닉스", keywords: ["마이크로닉스 케이스"] },
    { groupName: "앱코", keywords: ["앱코 케이스"] },
    { groupName: "다크플래쉬", keywords: ["다크플래쉬 케이스", "darkflash 케이스"] },
    { groupName: "쿨러마스터", keywords: ["쿨러마스터 케이스", "cooler master 케이스"] },
  ],
};

// 검색어트렌드 API 호출 — 최대 5개 그룹 비교, 최근 3개월 월별
async function fetchSearchTrends(keywordGroups) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("NAVER API 키 미설정");

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const resp = await fetch(SEARCH_TREND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    body: JSON.stringify({ startDate, endDate, timeUnit: "month", keywordGroups }),
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`DataLab API ${resp.status}: ${body}`);
  }
  return await resp.json();
}

// 브랜드별 평균 검색 비율 계산 (0~100)
function computeAvgRatios(data) {
  const result = {};
  for (const group of data.results || []) {
    const ratios = (group.data || []).map((d) => d.ratio || 0);
    result[group.title] = ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : 0;
  }
  return result;
}

// 모든 카테고리의 브랜드 가중치를 한 번에 수집
export async function fetchAllBrandWeights() {
  const results = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const [category, groups] of Object.entries(BRAND_KEYWORD_GROUPS)) {
    try {
      const data = await fetchSearchTrends(groups);
      results[category] = computeAvgRatios(data);
      logger.info(`DataLab 브랜드 가중치 완료: ${category} → ${JSON.stringify(results[category])}`);
      await sleep(500); // API 요청 간격
    } catch (err) {
      logger.warn(`DataLab 브랜드 가중치 실패 (${category}): ${err.message}`);
      results[category] = {};
    }
  }

  return results;
}

// 부품명에서 브랜드 가중치 점수 반환 (0~100)
export function getBrandScore(partName, category, brandWeightMap) {
  const weights = brandWeightMap[category];
  if (!weights) return 0;
  const lowerName = partName.toLowerCase();
  for (const [brand, score] of Object.entries(weights)) {
    if (lowerName.includes(brand.toLowerCase())) return score;
  }
  return 0;
}

// mallCount + DataLab 브랜드 점수 합산 인기도 점수
export function getPopularityScore(part, category, brandWeightMap) {
  const mallScore = Math.min((part.mallCount || 0) / 20, 1) * 100; // mallCount 20개 기준 정규화
  const brandScore = getBrandScore(part.name, category, brandWeightMap);
  return mallScore * 0.6 + brandScore * 0.4;
}
