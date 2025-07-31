// routes/recommend.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// /api/recommend (POST) : 예산·용도 기반 추천
router.post("/recommend", async (req, res) => {
  const { budget = 0, purpose = "작업용" } = req.body;
  const totalBudget = Number(budget);
  try {
    const db = getDB();
    const cpus = await db.collection("parts").find({ category: "cpu" }).toArray();
    const gpus = await db.collection("parts").find({ category: "gpu" }).toArray();

    // 성능 대비 가격(value) 계산
    const cpuRank = cpus.sort((a, b) => {
      const aScore = a.benchmarkScore?.passmarkscore || 0;
      const bScore = b.benchmarkScore?.passmarkscore || 0;
      return (bScore / b.price) - (aScore / a.price);
    });
    const gpuRank = gpus.sort((a, b) => {
      const aScore = a.benchmarkScore?.["3dmarkscore"] || 0;
      const bScore = b.benchmarkScore?.["3dmarkscore"] || 0;
      return (bScore / b.price) - (aScore / a.price);
    });

    // 예산 안에서 가장 높은 총점 조합 찾기
    let best = null;
    let bestScore = -Infinity;
    for (const cpu of cpuRank) {
      for (const gpu of gpuRank) {
        const totalPrice = Number(cpu.price) + Number(gpu.price);
        if (totalPrice > totalBudget) continue;
        // 작업용은 CPU 비중을 높이고, 게임용은 GPU 비중을 높이도록 가중치 조정
        const cpuScore = cpu.benchmarkScore?.passmarkscore || 0;
        const gpuScore = gpu.benchmarkScore?.["3dmarkscore"] || 0;
        let weightedScore = cpuScore + gpuScore;
        if (purpose === "작업용") weightedScore = cpuScore * 1.3 + gpuScore;
        if (purpose === "게임용") weightedScore = cpuScore + gpuScore * 1.3;
        if (weightedScore > bestScore) {
          bestScore = weightedScore;
          best = { cpu, gpu, totalPrice };
        }
      }
    }
    if (!best) best = { cpu: cpuRank[0], gpu: gpuRank[0], totalPrice: cpuRank[0].price + gpuRank[0].price };
    res.json({ recommended: best });
  } catch (err) {
    console.error("❌ [POST /recommend] error:", err);
    res.status(500).json({ error: "추천 실패" });
  }
});

export default router;
