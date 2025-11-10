// check-storage-socket.js - Storage 카테고리 중 소켓 정보가 있는 이상한 항목 확인
import { connectDB, getDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

async function checkStorageWithSocket() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection("parts");

    // Storage 카테고리 중 소켓 정보가 있는 항목 찾기 (이상한 경우)
    const query = {
      category: "storage",
      $or: [
        { "specs.sockets": { $exists: true, $ne: [], $ne: null } },
        { sockets: { $exists: true, $ne: [], $ne: null } },
      ],
    };

    const withSocket = await col.find(query).toArray();
    
    console.log(`\n📊 Storage 카테고리 중 소켓 정보가 있는 항목: ${withSocket.length}개`);
    
    if (withSocket.length === 0) {
      console.log("✅ Storage 카테고리에는 소켓 정보가 있는 항목이 없습니다. (정상)");
      console.log("💡 Storage(SSD/HDD)는 소켓 정보가 없는 것이 정상입니다.");
    } else {
      console.log("\n⚠️  소켓 정보가 있는 Storage 항목들:");
      withSocket.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.name}`);
        console.log(`   - 소켓: ${JSON.stringify(item.specs?.sockets || item.sockets)}`);
        console.log(`   - 카테고리: ${item.category}`);
        console.log(`   - 가격: ${item.price ? item.price.toLocaleString() + '원' : '없음'}`);
      });
    }
    
    process.exit(0);
  } catch (err) {
    console.error("❌ 확인 실패:", err);
    process.exit(1);
  }
}

checkStorageWithSocket();

