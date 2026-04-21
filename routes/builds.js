// routes/builds.js - 견적 저장/공유 (Feature 1)
import express from "express";
import { getDB } from "../db.js";
import crypto from "crypto";
import logger from "../utils/logger.js";
import { validate } from "../middleware/validate.js";
import { createBuildSchema } from "../schemas/builds.js";

const router = express.Router();

// POST /api/builds - 견적 저장
router.post("/", validate(createBuildSchema), async (req, res) => {
  try {
    const { builds, purpose, budget } = req.body;

    const db = getDB();
    const shareId = crypto.randomBytes(4).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.collection("builds").insertOne({
      shareId,
      builds,
      purpose: purpose || "",
      budget,
      createdAt: new Date(),
      expiresAt,
    });

    res.json({ shareId, expiresAt });
  } catch (err) {
    logger.error(`견적 저장 실패: ${err.message}`);
    res.status(500).json({ error: "견적 저장 실패" });
  }
});

// GET /api/builds/:shareId - 견적 조회
router.get("/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;
    if (!/^[a-f0-9]{8}$/.test(shareId))
      return res.status(400).json({ error: "유효하지 않은 shareId입니다." });

    const db = getDB();
    const build = await db.collection("builds").findOne({ shareId });
    if (!build) return res.status(404).json({ error: "견적을 찾을 수 없습니다." });
    if (new Date(build.expiresAt) < new Date()) return res.status(410).json({ error: "만료된 견적입니다." });

    res.json(build);
  } catch (err) {
    res.status(500).json({ error: "견적 조회 실패" });
  }
});

export default router;
