const BASE_URL = "";

export const cleanName = (raw) => raw?.split("\n")[0].split("(")[0].trim();
export const nameToSlug = (name) => encodeURIComponent(cleanName(name || ""));

// 5분 TTL 메모리 캐시 (SPA 내 재탐색 시 네트워크 요청 생략)
const _apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
function apiCacheGet(key) {
  const e = _apiCache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function apiCacheSet(key, data) {
  _apiCache.set(key, { data, ts: Date.now() });
}

export const fetchParts = async (category, limit = 800) => {
  const cacheKey = `parts:${category}:${limit}`;
  const cached = apiCacheGet(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(`${BASE_URL}/api/parts?category=${category}&limit=${limit}`);
    const data = await res.json();
    const result = data.map((part, i) => ({ id: i + 1, ...part }));
    apiCacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.error("[fetchParts] error:", e);
    return [];
  }
};

export const fetchPartDetail = async (category, slugOrName) => {
  try {
    const res = await fetch(`${BASE_URL}/api/parts/${category}/${nameToSlug(slugOrName)}`);
    return await res.json();
  } catch (e) {
    console.error("[fetchPartDetail] error:", e);
    return null;
  }
};

export const fetchPriceHistory = async (category, slugOrName) => {
  try {
    const res = await fetch(`${BASE_URL}/api/parts/${category}/${nameToSlug(slugOrName)}/history`);
    const data = await res.json();
    return data.priceHistory || [];
  } catch (e) {
    console.error("[fetchPriceHistory] error:", e);
    return [];
  }
};

export const fetchFullPartData = async (category) => {
  const parts = await fetchParts(category);
  return parts.map((p) => ({
    ...p,
    benchmarkScore: p.benchmarkScore ?? {
      passmarkscore: null,
      cinebenchSingle: null,
      cinebenchMulti: null,
      "3dmarkscore": null,
    },
  }));
};

export const fetchTrend = async (category, slugOrName) => {
  try {
    const res = await fetch(`${BASE_URL}/api/parts/${category}/${nameToSlug(slugOrName)}/trend`);
    return await res.json();
  } catch (e) {
    console.error("[fetchTrend] error:", e);
    return null;
  }
};

export const fetchMultiMallPrices = async (category, name) => {
  try {
    const res = await fetch(`${BASE_URL}/api/prices/${category}/${nameToSlug(name)}`);
    return await res.json();
  } catch (e) {
    console.error("[fetchMultiMallPrices] error:", e);
    return null;
  }
};

export const createAlert = async ({ category, name, targetPrice, email }) => {
  const res = await fetch(`${BASE_URL}/api/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, name, targetPrice, email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `알림 등록 실패 (${res.status})`);
  }
  return res.json();
};

export const fetchGptInfo = async (name) => {
  try {
    const res = await fetch(`${BASE_URL}/api/gpt-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partName: name }),
    });
    return await res.json();
  } catch (e) {
    console.error("[fetchGptInfo] error:", e);
    return null;
  }
};

export const fetchDanawaUrl = async (name) => {
  try {
    const res = await fetch(`${BASE_URL}/api/parts/danawa-url?name=${encodeURIComponent(name)}`);
    return await res.json();
  } catch (e) {
    console.error("[fetchDanawaUrl] error:", e);
    return null;
  }
};

export const fetchFilteredParts = async ({
  category, page = 1, limit = 24, sort = "popularity",
  q = "", brand = "all", socket = "all", chipset = "all",
  memCap = "all", memDdr = "all", storageType = "all",
  storageIface = "all", storageCap = "all", psuWatt = "all",
  caseForm = "all", conditionShow = "", conditionHide = "",
} = {}) => {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  params.set("page", page);
  params.set("limit", limit);
  params.set("sort", sort);
  if (q) params.set("q", q);
  if (brand && brand !== "all") params.set("brand", brand);
  if (socket && socket !== "all") params.set("socket", socket);
  if (chipset && chipset !== "all") params.set("chipset", chipset);
  if (memCap && memCap !== "all") params.set("memCap", memCap);
  if (memDdr && memDdr !== "all") params.set("memDdr", memDdr);
  if (storageType && storageType !== "all") params.set("storageType", storageType);
  if (storageIface && storageIface !== "all") params.set("storageIface", storageIface);
  if (storageCap && storageCap !== "all") params.set("storageCap", storageCap);
  if (psuWatt && psuWatt !== "all") params.set("psuWatt", psuWatt);
  if (caseForm && caseForm !== "all") params.set("caseForm", caseForm);
  if (conditionShow) params.set("conditionShow", conditionShow);
  if (conditionHide) params.set("conditionHide", conditionHide);

  try {
    const res = await fetch(`${BASE_URL}/api/parts?${params}`);
    const total = parseInt(res.headers.get("X-Total-Count") || "0");
    const totalPages = parseInt(res.headers.get("X-Total-Pages") || "1");
    const data = await res.json();
    const parts = data.map((p, i) => ({
      id: i + 1, ...p,
      benchmarkScore: p.benchmarkScore ?? { passmarkscore: null, cinebenchSingle: null, cinebenchMulti: null, "3dmarkscore": null },
    }));
    return { parts, total, totalPages };
  } catch (e) {
    console.error("[fetchFilteredParts] error:", e);
    return { parts: [], total: 0, totalPages: 1 };
  }
};

export const fetchSearch = async ({ q, category, priceMin, priceMax, sort = "price_asc", limit = 50 }) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (priceMin) params.set("priceMin", priceMin);
  if (priceMax) params.set("priceMax", priceMax);
  params.set("sort", sort);
  params.set("limit", limit);

  try {
    const res = await fetch(`${BASE_URL}/api/parts/search?${params}`);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error("[fetchSearch]", e);
    return [];
  }
};
