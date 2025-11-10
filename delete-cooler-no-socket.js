// delete-cooler-no-socket.js - Cooler 카테고리 중 소켓 정보가 없는 항목 삭제
import { connectDB, getDB } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

async function deleteCoolerNoSocket() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection("parts");

    // 소켓 정보가 없는 cooler 항목 찾기
    const query = {
      category: "cooler",
      $or: [
        { "specs.sockets": { $exists: false } },  // specs.sockets 필드가 없거나
        { "specs.sockets": [] },                   // 빈 배열이거나
        { "specs.sockets": null },                 // null이거나
        { specs: { $exists: false } },            // specs 필드 자체가 없거나
      ],
    };

    // 먼저 삭제할 항목들을 확인
    const toDelete = await col.find(query).toArray();
    
    console.log(`\n📋 삭제 대상 항목 (${toDelete.length}개):`);
    console.log("=".repeat(80));
    
    if (toDelete.length === 0) {
      console.log("✅ 삭제할 항목이 없습니다.");
      process.exit(0);
    }

    // 소켓 정보 상태별로 분류
    const noSpecs = toDelete.filter(item => !item.specs);
    const emptySockets = toDelete.filter(item => item.specs && (!item.specs.sockets || item.specs.sockets.length === 0));
    const nullSockets = toDelete.filter(item => item.specs && item.specs.sockets === null);

    console.log(`\n📊 소켓 정보 상태:`);
    console.log(`   - specs 필드 없음: ${noSpecs.length}개`);
    console.log(`   - sockets 빈 배열: ${emptySockets.length}개`);
    console.log(`   - sockets null: ${nullSockets.length}개`);

    console.log(`\n🗑️  삭제할 항목 목록 (최대 20개):`);
    toDelete.slice(0, 20).forEach((item, index) => {
      const socketInfo = item.specs?.sockets ? 
        (Array.isArray(item.specs.sockets) ? item.specs.sockets.join(', ') : 'null') : 
        '없음';
      console.log(`   ${index + 1}. ${item.name}`);
      console.log(`      소켓 정보: ${socketInfo}`);
    });
    if (toDelete.length > 20) {
      console.log(`   ... 외 ${toDelete.length - 20}개`);
    }

    // 삭제 실행
    console.log(`\n🗑️  삭제 진행 중...`);
    const result = await col.deleteMany(query);

    console.log(`\n✅ 삭제 완료: ${result.deletedCount}개 항목이 삭제되었습니다.`);
    console.log(`   - specs 필드 없음: ${noSpecs.length}개`);
    console.log(`   - sockets 빈 배열: ${emptySockets.length}개`);
    console.log(`   - sockets null: ${nullSockets.length}개`);
    
    process.exit(0);
  } catch (err) {
    console.error("❌ 삭제 실패:", err);
    process.exit(1);
  }
}

deleteCoolerNoSocket();

