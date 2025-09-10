// routes/recommend.js
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// /api/recommend (POST) : 예산·용도 기반 추천
router.post("/", async (req, res) => {
  const { budget = 0, purpose = "작업용" } = req.body;
  const totalBudget = Number(budget);
  try {
    const db = getDB();
    const cpus = await db.collection("parts").find({ category: "cpu" }).toArray();
    const gpus = await db.collection("parts").find({ category: "gpu" }).toArray();
    const memories = await db.collection("parts").find({ category: "memory" }).toArray();
    const boards = await db.collection("parts").find({ category: "motherboard" }).toArray();

    let best = null;
    let bestScore = -Infinity;

    for (const cpu of cpus) {
      const cpuScore = cpu.benchmarkScore?.passmarkscore || 0;
      for (const gpu of gpus) {
        const gpuScore = gpu.benchmarkScore?.["3dmarkscore"] || 0;
        for (const memory of memories) {
          for (const board of boards) {
            // 간단한 소켓/칩셋 호환성 체크
            if (
              (cpu.socket && board.socket && cpu.socket !== board.socket) ||
              (cpu.supportedChipsets &&
                board.chipset &&
                !cpu.supportedChipsets.includes(board.chipset))
            ) {
              continue;
            }

            const cpuPrice = Number(cpu.price);
            const gpuPrice = Number(gpu.price);
            const memoryPrice = Number(memory.price);
            const boardPrice = Number(board.price);
            if ([cpuPrice, gpuPrice, memoryPrice, boardPrice].some(Number.isNaN)) {
              continue;
            }
            const totalPrice = cpuPrice + gpuPrice + memoryPrice + boardPrice;
            if (totalPrice > totalBudget) continue;

            let weightedScore = cpuScore + gpuScore;
            if (purpose === "작업용") weightedScore = cpuScore * 1.3 + gpuScore;
            if (purpose === "게임용") weightedScore = cpuScore + gpuScore * 1.3;

            if (weightedScore > bestScore) {
              bestScore = weightedScore;
              best = {
                cpu,
                gpu,
                memory,
                motherboard: board,
                totalPrice,
              };
            }
          }
        }
      }
    }

    if (!best && cpus.length && gpus.length && memories.length && boards.length) {
      const memory = memories.sort((a, b) => a.price - b.price)[0];
      const board = boards.sort((a, b) => a.price - b.price)[0];
      const cpu = cpus[0];
      const gpu = gpus[0];
      const totalPrice =
        Number(cpu.price) + Number(gpu.price) + Number(memory.price) + Number(board.price);
      best = { cpu, gpu, memory, motherboard: board, totalPrice };
    }

    res.json({ recommended: best });
  } catch (err) {
    console.error("❌ [POST /recommend] error:", err);
    res.status(500).json({ error: "추천 실패" });
  }
});

export default router;
