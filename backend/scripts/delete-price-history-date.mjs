import "dotenv/config";
import { MongoClient } from "mongodb";

const TARGET_DATE = "2026-05-02";

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const col = client.db("pcsite").collection("parts");

    // 대상 확인
    const before = await col.countDocuments({ "priceHistory.date": TARGET_DATE });
    console.log(`📊 삭제 대상: ${TARGET_DATE} 가격 항목이 있는 문서 ${before}개`);

    if (before === 0) {
      console.log("✅ 삭제할 데이터 없음");
      return;
    }

    // $pull로 priceHistory 배열에서 해당 날짜 항목 제거
    const result = await col.updateMany(
      { "priceHistory.date": TARGET_DATE },
      { $pull: { priceHistory: { date: TARGET_DATE } } }
    );

    console.log(`✅ 완료: ${result.modifiedCount}개 문서에서 ${TARGET_DATE} 가격 항목 삭제`);

    // 검증
    const after = await col.countDocuments({ "priceHistory.date": TARGET_DATE });
    console.log(`🔍 검증: 잔여 ${TARGET_DATE} 항목 = ${after}개`);

    // 카테고리별 결과
    const stats = await col.aggregate([
      { $match: { "priceHistory.date": { $exists: true } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    console.log("\n📈 카테고리별 현재 priceHistory 보유 문서 수:");
    stats.forEach(s => console.log(`  ${s._id}: ${s.count}개`));

  } finally {
    await client.close();
  }
}

run().catch(err => { console.error("❌ 실패:", err); process.exit(1); });
