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
