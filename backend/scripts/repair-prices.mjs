/**
 * repair-prices.mjs
 * 잘못된 가격이 저장된 부품을 찾아서 네이버 쇼핑 검색으로 재수정합니다.
 *
 * 실행: node backend/scripts/repair-prices.mjs
 *       node backend/scripts/repair-prices.mjs --dry-run   (실제 DB 변경 없음)
 *       node backend/scripts/repair-prices.mjs --name "SK하이닉스"  (특정 이름 필터)
 */

import { MongoClient } from "mongodb";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// Load .env from backend/ or project root (whichever has more keys)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", "..", ".env");  // project root .env
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

import { extractCriticalTokens, validateNaverPrice } from "../utils/priceValidator.js";

const PRODUCT_EXCLUDED_RE = /병행수입|해외직구|해외구매|리퍼|refurb|중고/i;
const MONGODB_URI = process.env.MONGODB_URI;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const NAVER_DELAY_MS = 400;

const isDryRun = process.argv.includes("--dry-run");
const nameFilter = (() => {
  const idx = process.argv.indexOf("--name");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const categoryFilter = (() => {
  const idx = process.argv.indexOf("--category");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

if (!MONGODB_URI) { console.error("MONGODB_URI 환경변수 없음"); process.exit(1); }
if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) { console.error("NAVER API 키 없음"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchNaver(query) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=20&sort=sim`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())?.items ?? [];
}

function maxHistoryPrice(part) {
  const hist = part.priceHistory ?? [];
  if (hist.length === 0) return null;
  return Math.max(...hist.map((h) => h.price).filter(Boolean));
}

async function main() {
  if (isDryRun) console.log("[DRY-RUN] DB 변경 없음\n");

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
  await client.connect();
  const url = new URL(MONGODB_URI);
  const dbName = url.pathname.substring(1) || "pcsite";
  const col = client.db(dbName).collection("parts");

  const query = {};
  if (nameFilter) query.name = { $regex: nameFilter, $options: "i" };
  if (categoryFilter) query.category = categoryFilter;
  const parts = await col
    .find(query, { projection: { name: 1, category: 1, price: 1, priceHistory: 1 } })
    .toArray();

  console.log(`전체 부품 ${parts.length}개 검사 중...\n`);

  const corrupted = [];
  for (const part of parts) {
    const maxHist = maxHistoryPrice(part);
    const cur = part.price ?? 0;
    // 현재가가 최고 이력가의 70% 미만이면 의심스러운 값
    if (maxHist && cur > 0 && cur < maxHist * 0.70) {
      corrupted.push({ part, maxHist, cur });
    }
  }

  if (corrupted.length === 0 && !nameFilter) {
    console.log("가격 이상 부품 없음 (또는 이력 데이터 부족)");
    await client.close();
    return;
  }

  const targets = (nameFilter || categoryFilter) ? parts : corrupted.map((c) => c.part);
  console.log(`수정 대상: ${targets.length}개`);
  if (!nameFilter) {
    for (const { part, cur, maxHist } of corrupted) {
      console.log(`  [${part.category}] ${part.name}: 현재 ${cur.toLocaleString()}원 / 이력최고 ${maxHist.toLocaleString()}원`);
    }
  }
  console.log();

  let fixed = 0, failed = 0;

  for (const part of targets) {
    // 중고/병행수입/해외직구 제품은 Naver 새제품 가격으로 갱신하면 안 됨
    if (PRODUCT_EXCLUDED_RE.test(part.name)) {
      console.log(`  SKIP [${part.category}] ${part.name}: 중고/병행수입 제품 제외`);
      failed++;
      continue;
    }

    try {
      const rawItems = await searchNaver(part.name);
      const tokens = extractCriticalTokens(part.name);
      // referencePrice=null 로 tolerance 검사 없이 토큰 매칭만 적용
      const result = validateNaverPrice(part.name, rawItems, null);

      if (!result.valid || !result.price) {
        console.log(`  SKIP [${part.category}] ${part.name}: ${result.reason} (매칭 ${result.matchedCount}/${result.totalCount})`);
        console.log(`       토큰: [${tokens.join(", ")}]`);
        failed++;
        await sleep(NAVER_DELAY_MS);
        continue;
      }

      const old = part.price ?? 0;
      const newPrice = result.price;

      // 현재 가격 대비 30% 미만으로 떨어지면 비정상 의심 — 스킵
      if (old > 50000 && newPrice < old * 0.3) {
        console.log(`  WARN [${part.category}] ${part.name}: 가격 급락 의심 (${old.toLocaleString()}원 → ${newPrice.toLocaleString()}원), 스킵`);
        console.log(`       토큰: [${tokens.join(", ")}]`);
        failed++;
        await sleep(NAVER_DELAY_MS);
        continue;
      }
      console.log(`  FIX  [${part.category}] ${part.name}`);
      console.log(`       ${old.toLocaleString()}원 → ${newPrice.toLocaleString()}원 (매칭 ${result.matchedCount}/${result.totalCount})`);
      console.log(`       토큰: [${tokens.join(", ")}]`);

      if (!isDryRun) {
        const today = new Date().toISOString().slice(0, 10);
        await col.updateOne({ _id: part._id }, { $set: { price: newPrice, updatedAt: new Date() } });
        await col.updateOne(
          { _id: part._id, "priceHistory.date": { $ne: today } },
          { $push: { priceHistory: { $each: [{ date: today, price: newPrice }], $slice: -90 } } }
        );
      }
      fixed++;
    } catch (err) {
      console.log(`  ERROR [${part.name}]: ${err.message}`);
      failed++;
    }
    await sleep(NAVER_DELAY_MS);
  }

  console.log(`\n완료 — 수정 ${fixed}개 / 실패 ${failed}개`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
