// routes/backfillImage.js
// 이미지 백필용 라우터
import express from "express";

const router = express.Router();

// 이미지 백필은 각 sync 파일에서 직접 처리됩니다.
// 이 라우터는 호환성을 위해 유지됩니다.

router.post("/backfill-image", async (req, res) => {
  res.json({
    message: "이미지 백필은 각 카테고리별 sync 엔드포인트에서 자동으로 처리됩니다.",
    endpoints: [
      "POST /api/admin/sync-cpus",
      "POST /api/admin/sync-gpus",
      "POST /api/admin/sync-motherboards",
      "POST /api/admin/sync-memories",
      "POST /api/admin/sync-psus",
      "POST /api/admin/sync-cases",
      "POST /api/admin/sync-coolers",
      "POST /api/admin/sync-storages"
    ]
  });
});

export default router;
