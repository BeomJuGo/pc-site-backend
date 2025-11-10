// check-cpu-ai.js - CPU 항목의 AI 데이터 상태 확인
import { connectDB, getDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

async function checkCpuAI() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection("parts");

    const total = await col.countDocuments({ category: "cpu" });
    const withReview = await col.countDocuments({
      category: "cpu",
      review: { $exists: true, $ne: "", $ne: null },
    });
    const withSpecSummary = await col.countDocuments({
      category: "cpu",
      specSummary: { $exists: true, $ne: "", $ne: null },
    });
    const withoutReview = await col.countDocuments({
      category: "cpu",
      $or: [
        { review: { $exists: false } },
        { review: "" },
        { review: null },
      ],
    });
    const withoutSpecSummary = await col.countDocuments({
      category: "cpu",
      $or: [
        { specSummary: { $exists: false } },
        { specSummary: "" },
        { specSummary: null },
      ],
    });
    const withoutBoth = await col.countDocuments({
      category: "cpu",
      $or: [
        { review: { $exists: false } },
        { review: "" },
        { review: null },
        { specSummary: { $exists: false } },
        { specSummary: "" },
        { specSummary: null },
      ],
    });

    console.log("\n📊 CPU AI 데이터 상태:");
    console.log(`   총 CPU 항목: ${total}개`);
    console.log(`   review 있는 항목: ${withReview}개`);
    console.log(`   specSummary 있는 항목: ${withSpecSummary}개`);
    console.log(`   review 없는 항목: ${withoutReview}개`);
    console.log(`   specSummary 없는 항목: ${withoutSpecSummary}개`);
    console.log(`   review 또는 specSummary 없는 항목: ${withoutBoth}개`);

    // review나 specSummary가 없는 항목 몇 개 샘플 보기
    if (withoutBoth > 0) {
      const samples = await col
        .find({
          category: "cpu",
          $or: [
            { review: { $exists: false } },
            { review: "" },
            { review: null },
            { specSummary: { $exists: false } },
            { specSummary: "" },
            { specSummary: null },
          ],
        })
        .limit(5)
        .project({ name: 1, review: 1, specSummary: 1 })
        .toArray();

      console.log("\n📋 review 또는 specSummary 없는 항목 샘플 (최대 5개):");
      samples.forEach((item, idx) => {
        console.log(`   ${idx + 1}. ${item.name}`);
        console.log(`      review: ${item.review || "(없음)"}`);
        console.log(`      specSummary: ${item.specSummary || "(없음)"}`);
      });
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ 확인 실패:", err);
    process.exit(1);
  }
}

checkCpuAI();

