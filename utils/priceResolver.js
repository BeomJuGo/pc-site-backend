import { searchNaverShopping, parseNaverItems } from "./naverShopping.js";
import logger from "./logger.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEVIATION_THRESHOLD = 0.5; // 50% 이상 차이면 GPT 검증

async function validatePriceWithGPT(name, danawaPrice, naverPrice) {
  if (!OPENAI_API_KEY) return Math.min(danawaPrice, naverPrice);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{
          role: "user",
          content: `PC 부품 "${name}"의 두 가격이 크게 차이납니다.\n다나와 크롤링 가격: ${danawaPrice.toLocaleString()}원\n네이버쇼핑 최저가: ${naverPrice.toLocaleString()}원\n\n현재 한국 온라인 시장에서 더 정확한 실거래 가격을 숫자만 반환하세요. (예: 182000)`,
        }],
        max_completion_tokens: 20,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content?.replace(/[^0-9]/g, "");
    const validated = parseInt(raw);
    if (validated === danawaPrice || validated === naverPrice) return validated;
  } catch (err) {
    logger.warn(`가격 GPT 검증 실패 (${name}): ${err.message}`);
  }
  return Math.min(danawaPrice, naverPrice);
}

/**
 * 다나와 가격과 네이버쇼핑 최저가를 비교해 가장 정확한 가격을 반환합니다.
 * @returns {{ price: number, danawaPrice: number, naverPrice: number|null }}
 */
export async function resolvePrice(partName, danawaPrice) {
  const dP = danawaPrice || 0;

  try {
    const data = await searchNaverShopping(partName, 5);
    const items = parseNaverItems(data);
    if (!items.length) return { price: dP, danawaPrice: dP, naverPrice: null };

    const naverMin = items[0].price;
    if (!naverMin || naverMin <= 0) return { price: dP, danawaPrice: dP, naverPrice: null };

    if (!dP) return { price: naverMin, danawaPrice: 0, naverPrice: naverMin };

    const lo = Math.min(dP, naverMin);
    const hi = Math.max(dP, naverMin);
    const deviation = (hi - lo) / lo;

    if (deviation > DEVIATION_THRESHOLD) {
      logger.warn(`가격 편차 큼 (${partName}): 다나와 ${dP.toLocaleString()}원 vs 네이버 ${naverMin.toLocaleString()}원 → GPT 검증`);
      const validated = await validatePriceWithGPT(partName, dP, naverMin);
      return { price: validated, danawaPrice: dP, naverPrice: naverMin };
    }

    return { price: lo, danawaPrice: dP, naverPrice: naverMin };
  } catch (err) {
    logger.warn(`resolvePrice 실패 (${partName}): ${err.message}`);
    return { price: dP, danawaPrice: dP, naverPrice: null };
  }
}
