// routes/backfillAI.js
// AI 한줄평 백필용 라우터
import express from "express";

const router = express.Router();

// AI 백필은 각 sync 파일에서 직접 처리됩니다.
// 이 라우터는 호환성을 위해 유지됩니다.

router.post("/backfill-ai", async (req, res) => {
  res.json({
    message: "AI 백필은 각 카테고리별 sync 엔드포인트에서 force 옵션을 사용하세요.",
    endpoints: [
      "POST /api/admin/sync-cpus (body: { force: true })",
      "POST /api/admin/sync-gpus (body: { force: true })",
      "POST /api/admin/sync-motherboards (body: { force: true })",
      "POST /api/admin/sync-memories (body: { force: true })",
      "POST /api/admin/sync-psus (body: { force: true })",
      "POST /api/admin/sync-cases (body: { force: true })",
      "POST /api/admin/sync-coolers (body: { force: true })",
      "POST /api/admin/sync-storages (body: { force: true })"
    ]
  });
});

export default router;
