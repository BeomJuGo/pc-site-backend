import { connectDB, getDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

async function deleteGpuData() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection("parts");

    console.log("🗑️ 'gpu' 카테고리 데이터 삭제 시작...");
    const result = await col.deleteMany({ category: "gpu" });
    console.log(`✅ ${result.deletedCount}개 GPU 데이터 삭제 완료.`);
  } catch (error) {
    console.error("❌ GPU 데이터 삭제 실패:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

deleteGpuData();


