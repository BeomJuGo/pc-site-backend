import logger from "./logger.js";

const API_URL = "https://openapi.naver.com/v1/search/shop.json";

export async function searchNaverShopping(query, display = 20, sort = "sim") {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const url = `${API_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn(`네이버 쇼핑 API ${res.status}: ${query}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.error(`네이버 쇼핑 API 실패: ${err.message}`);
    return null;
  }
}

export function parseNaverItems(data) {
  if (!data?.items?.length) return [];
  return data.items
    .filter((item) => item.lprice && parseInt(item.lprice) >= 1000)
    .map((item) => ({
      mallName: item.mallName || "기타",
      title: item.title.replace(/<[^>]*>/g, "").trim(),
      price: parseInt(item.lprice),
      highPrice: item.hprice ? parseInt(item.hprice) : null,
      link: item.link,
      image: item.image || null,
      brand: item.brand || null,
      productId: item.productId || null,
    }))
    .sort((a, b) => a.price - b.price);
}
