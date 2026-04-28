import "dotenv/config";
import { connectDB, getDB } from "../db.js";
import { fetchNaverPrice } from "../utils/priceResolver.js";
import logger from "../utils/logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await connectDB();
const db = getDB();

const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// DB 정리: 90일 이전 가격 이력, 가성비 캐시, 중복 부품
const r1 = await db.collection("cached_sets").deleteMany({ _id: { $regex: "가성비" } });
await db.collection("parts").deleteMany({
  category: "memory",
  name: { $regex: "노트북|SO-DIMM|SODIMM|소딤|notebook|laptop", $options: "i" },
});
await db.collection("parts").updateMany(
  { "priceHistory.date": { $lt: cutoff } },
  { $pull: { priceHistory: { date: { $lt: cutoff } } } }
);
logger.info(`DB 정리 완료 (가성비 캐시 ${r1.deletedCount}개, 90일 이전 이력 삭제)`);

// 가격 업데이트
const parts = await db.collection("parts").find(
  {},
  { projection: { _id: 1, name: 1, category: 1, price: 1 } }
).toArray();

logger.info(`가격 업데이트 시작: ${parts.length}개 부품`);

let updated = 0, skipped = 0, failed = 0, deleted = 0;
const today = new Date().toISOString().slice(0, 10);
const zeroPriceIds = [];

for (const part of parts) {
  try {
    const { price: naverPrice, mallCount } = await fetchNaverPrice(part.name);
    if (!naverPrice || naverPrice <= 0) {
      // 가격을 못 가져왔고 DB에도 가격이 없으면 삭제 대상
      if (!part.price || part.price <= 0) {
        zeroPriceIds.push(part._id);
      } else {
        // DB에는 이전 가격이 있지만 이번에 못가져온 경우 → skip (일시적 장애일 수도)
        skipped++;
      }
      continue;
    }
    // 가격 보호: 이전 가격이 있고 새 가격이 1/3 미만으로 급락 → 정크 리스팅 가능성 → skip
    if (part.price && part.price > 0 && naverPrice < part.price / 3) {
      logger.warn(`가격 급락 감지, 건너뜀: ${part.name} (이전 ${part.price.toLocaleString()}원 → 신규 ${naverPrice.toLocaleString()}원)`);
      skipped++;
      continue;
    }
    await db.collection("parts").updateOne(
      { _id: part._id },
      [
        {
          $set: {
            price: naverPrice,
            mallCount: mallCount || 0,
            priceHistory: {
              $slice: [
                {
                  $concatArrays: [
                    {
                      $filter: {
                        input: { $ifNull: ["$priceHistory", []] },
                        cond: { $ne: ["$$this.date", today] },
                      },
                    },
                    [{ date: today, price: naverPrice }],
                  ],
                },
                -90,
              ],
            },
          },
        },
      ]
    );
    updated++;
  } catch (err) {
    logger.error(`가격 업데이트 실패: ${part.name} — ${err.message}`);
    failed++;
  }
  await sleep(200);
}

// 가격을 도저히 조회할 수 없는 부품 일괄 삭제
if (zeroPriceIds.length > 0) {
  const result = await db.collection("parts").deleteMany({ _id: { $in: zeroPriceIds } });
  deleted = result.deletedCount;
  logger.info(`가격 0원 부품 자동 삭제: ${deleted}개`);
}

logger.info(`완료: 성공 ${updated}개, 건너뜀 ${skipped}개, 실패 ${failed}개, 삭제 ${deleted}개 (총 ${parts.length}개)`);
process.exit(0);
