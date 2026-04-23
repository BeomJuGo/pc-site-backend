const BASE_URL = "https://pc-site-backend.onrender.com";

export const cleanName = (raw) => raw?.split("\n")[0].split("(")[0].trim();
export const nameToSlug = (name) => encodeURIComponent(cleanName(name || ""));

export const fetchParts = async (category) => {
  try {
    const res = await fetch(`${BASE_URL}/api/parts?category=${category}`);
    const data = await res.json();
    return data.map((part, i) => ({ id: i + 1, ...part }));
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
