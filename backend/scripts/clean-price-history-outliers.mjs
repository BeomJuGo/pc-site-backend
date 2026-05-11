/**
 * 가격 이상치 탐지 & 삭제 스크립트
 * - 기준: 각 제품의 (priceHistory 전체 + 현재 price) 중앙값(median) 대비 ±30% 초과 항목 제거
 * - 안전장치: 삭제 대상이 전체 이력의 60% 초과이면 건너뜀 (기준 자체가 불확실)
 * - 안전장치: priceHistory 2개 미만이면 비교 불가라 건너뜀
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const THRESHOLD = 0.30;      // 30% 이상 이탈 = 이상치
const MAX_REMOVE_RATIO = 0.60; // 전체 이력의 60% 초과 삭제 시 안전을 위해 스킵

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db("pcsite").collection("parts");

  const parts = await col
    .find(
      { priceHistory: { $exists: true, $not: { $size: 0 } } },
      { projection: { _id: 1, name: 1, category: 1, price: 1, priceHistory: 1 } }
    )
    .toArray();

  console.log(`\n📊 총 ${parts.length}개 부품 분석 중...\n`);

  const statsByCategory = {};
  let totalOutlierEntries = 0;
  let totalModifiedParts = 0;
  let totalSkipped = 0;
  const removedLog = [];

  for (const part of parts) {
    const history = (part.priceHistory || []).filter(h => h.price > 0);
    if (history.length < 2) continue;

    const currentPrice = part.price > 0 ? part.price : null;
    const allPrices = history.map(h => h.price);
    // 현재 가격도 중앙값 계산에 포함 (끝부분 이상치 검출 강화)
    const refPrices = currentPrice ? [...allPrices, currentPrice] : allPrices;
    const ref = median(refPrices);
    if (ref === 0) continue;

    const outliers = history.filter(h => {
      const deviation = Math.abs(h.price - ref) / ref;
      return deviation > THRESHOLD;
    });

    if (outliers.length === 0) continue;

    // 안전장치: 전체 이력의 60% 초과 삭제 시 스킵
    if (outliers.length / history.length > MAX_REMOVE_RATIO) {
      totalSkipped++;
      continue;
    }

    const outlierDates = outliers.map(h => h.date);

    await col.updateOne(
      { _id: part._id },
      { $pull: { priceHistory: { date: { $in: outlierDates } } } }
    );

    totalOutlierEntries += outliers.length;
    totalModifiedParts++;

    const cat = part.category || "unknown";
    if (!statsByCategory[cat]) statsByCategory[cat] = { parts: 0, entries: 0 };
    statsByCategory[cat].parts++;
    statsByCategory[cat].entries += outliers.length;

    removedLog.push({
      category: cat,
      name: part.name,
      ref: Math.round(ref),
      removed: outliers.map(h => ({ date: h.date, price: h.price, deviation: `${(Math.abs(h.price - ref) / ref * 100).toFixed(1)}%` })),
    });
  }

  // ─── 결과 출력 ───────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════");
  console.log("  카테고리별 이상치 삭제 요약");
  console.log("══════════════════════════════════════════");
  for (const [cat, s] of Object.entries(statsByCategory).sort((a, b) => b[1].entries - a[1].entries)) {
    console.log(`  ${cat.padEnd(12)}: ${s.parts}개 제품, ${s.entries}개 항목 삭제`);
  }
  console.log("──────────────────────────────────────────");
  console.log(`  총 수정 제품: ${totalModifiedParts}개`);
  console.log(`  총 삭제 항목: ${totalOutlierEntries}개`);
  console.log(`  안전 스킵:    ${totalSkipped}개 (이력 60%+ 삭제 대상)`);
  console.log("══════════════════════════════════════════\n");

  if (removedLog.length > 0) {
    console.log("📋 상세 삭제 내역 (제품별):");
    for (const item of removedLog) {
      console.log(`\n  [${item.category}] ${item.name}`);
      console.log(`    기준가(중앙값): ${item.ref.toLocaleString()}원`);
      for (const r of item.removed) {
        const dir = r.price < item.ref ? "▼급락" : "▲급등";
        console.log(`    ${dir} ${r.date}: ${r.price.toLocaleString()}원 (이탈 ${r.deviation})`);
      }
    }
  }

  await client.close();
  console.log("\n✅ 완료");
}

run().catch(err => { console.error("❌ 실패:", err); process.exit(1); });
