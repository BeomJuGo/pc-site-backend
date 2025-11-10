import { connectDB, getDB } from './db.js';

async function deleteMotherboardData() {
  try {
    await connectDB();
    const db = getDB();
    const col = db.collection('parts');

    // 메인보드 카테고리 데이터 개수 확인
    const count = await col.countDocuments({ category: 'motherboard' });
    console.log(`📊 삭제 전 메인보드 데이터 개수: ${count}개`);

    if (count === 0) {
      console.log('✅ 삭제할 메인보드 데이터가 없습니다.');
      return;
    }

    // 메인보드 카테고리 데이터 삭제
    const result = await col.deleteMany({ category: 'motherboard' });
    console.log(`🗑️ 삭제 완료: ${result.deletedCount}개`);
    console.log('✅ 메인보드 데이터 삭제 완료. 이제 sync-all.js를 실행하세요.');
  } catch (error) {
    console.error('❌ 삭제 실패:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

deleteMotherboardData();

