// routes/updatePrices.js
// 가격 업데이트는 각 sync 파일에서 직접 처리하므로 이 파일은 호환성을 위해 유지
import express from "express";

const router = express.Router();

// 가격 업데이트는 각 sync 파일(syncCPUs.js, syncGPUs.js 등)에서 직접 처리됩니다.
// 이 라우터는 호환성을 위해 유지되며, 필요시 가격만 업데이트하는 엔드포인트를 추가할 수 있습니다.

router.post("/update-prices", async (req, res) => {
  res.json({
    message: "가격 업데이트는 각 카테고리별 sync 엔드포인트를 사용하세요.",
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
