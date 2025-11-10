// update-rtx5050-benchmark.js - RTX 5050 벤치마크 점수 추가
import { connectDB, getDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

async function updateRTX5050Benchmark() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection("parts");

    // RTX 5050 GPU 찾기
    const rtx5050GPUs = await col
      .find({
        category: "gpu",
        $or: [
          { name: /RTX\s*5050/i },
          { name: /5050/i }
        ]
      })
      .toArray();

    console.log(`\n📊 RTX 5050 GPU 발견: ${rtx5050GPUs.length}개\n`);

    if (rtx5050GPUs.length === 0) {
      console.log("⚠️ RTX 5050 GPU를 찾을 수 없습니다.");
      process.exit(0);
    }

    let updated = 0;
    const benchmarkScore = { "3dmarkscore": 11375 };

    for (const gpu of rtx5050GPUs) {
      const update = {
        $set: {
          benchmarkScore: benchmarkScore
        }
      };

      await col.updateOne(
        { _id: gpu._id },
        update
      );

      updated++;
      console.log(`✅ 업데이트: ${gpu.name} → 벤치마크 점수: 11375`);
    }

    console.log(`\n📊 업데이트 완료: ${updated}/${rtx5050GPUs.length}개 RTX 5050에 벤치마크 점수 추가됨\n`);
    process.exit(0);
  } catch (err) {
    console.error("❌ 업데이트 실패:", err);
    process.exit(1);
  }
}

updateRTX5050Benchmark();

