// routes/backfillBenchmark.js
// 벤치마크 백필용 라우터
import express from "express";

const router = express.Router();

// 벤치마크 백필은 각 sync 파일에서 직접 처리됩니다.
// 이 라우터는 호환성을 위해 유지됩니다.

router.post("/backfill-benchmark", async (req, res) => {
  res.json({
    message: "벤치마크 백필은 각 카테고리별 sync 엔드포인트에서 자동으로 처리됩니다.",
    endpoints: [
      "POST /api/admin/sync-cpus (CPU 벤치마크 포함)",
      "POST /api/admin/sync-gpus (GPU 벤치마크 포함)",
      "POST /api/admin/sync-storages (스토리지 성능 점수 포함)"
    ]
  });
});

export default router;
