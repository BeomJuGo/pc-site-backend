import { connectDB, getDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

async function deleteCoolerData() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection("parts");

    console.log("🗑️ 'cooler' 카테고리 데이터 삭제 시작...");
    const result = await col.deleteMany({ category: "cooler" });
    console.log(`✅ ${result.deletedCount}개 쿨러 데이터 삭제 완료.`);
  } catch (error) {
    console.error("❌ 쿨러 데이터 삭제 실패:", error);
  } finally {
    process.exit(0);
  }
}

deleteCoolerData();









