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

const CATEGORY_LABELS = {
  cpu: "CPU", gpu: "GPU", motherboard: "Motherboard", memory: "Memory",
  storage: "Storage", psu: "PSU", case: "Case", cooler: "Cooler",
};
const PURPOSE_LABELS = { "게임용": "Gaming", "작업용": "Work/Create", "사무용": "Office", "가성비": "Value" };

// GET /api/builds/:shareId/pdf
router.get("/:shareId/pdf", async (req, res) => {
  try {
    const { shareId } = req.params;
    if (!/^[a-f0-9]{8}$/.test(shareId))
      return res.status(400).json({ error: "유효하지 않은 shareId입니다." });

    const db = getDB();
    const build = await db.collection("builds").findOne({ shareId });
    if (!build) return res.status(404).json({ error: "견적을 찾을 수 없습니다." });
    if (new Date(build.expiresAt) < new Date()) return res.status(410).json({ error: "만료된 견적입니다." });

    const { default: PDFDocument } = await import("pdfkit");
    const doc = new PDFDocument({ margin: 50, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="build-${shareId}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(22).font("Helvetica-Bold").text("PC Build Estimate", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#555555")
      .text(`ID: ${shareId}  |  Created: ${new Date(build.createdAt).toLocaleDateString("en-CA")}`, { align: "center" });
    if (build.purpose)
      doc.text(`Purpose: ${PURPOSE_LABELS[build.purpose] || build.purpose}  |  Budget: ${Number(build.budget || 0).toLocaleString()} KRW`, { align: "center" });
    doc.fillColor("#000000").moveDown(0.8);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(1).stroke("#cccccc");
    doc.moveDown(0.5);

    // Parts table header
    doc.fontSize(11).font("Helvetica-Bold")
      .text("Category", 50, doc.y, { width: 110, continued: true })
      .text("Part Name", { width: 300, continued: true })
      .text("Price (KRW)", { width: 85, align: "right" });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke("#aaaaaa");
    doc.moveDown(0.3);

    // Parts rows
    let total = 0;
    const items = Array.isArray(build.builds) ? build.builds : [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const cat = item.category || "";
      const name = item.name || item.partName || String(item);
      const price = Number(item.price) || 0;
      total += price;

      const label = CATEGORY_LABELS[cat] || cat.toUpperCase();
      const safeName = name.replace(/[^\x20-\x7E]/g, (c) => {
        const common = { "삼성": "Samsung", "LG": "LG", "인텔": "Intel", "엔비디아": "NVIDIA" };
        for (const [k, v] of Object.entries(common)) if (name.includes(k)) return v;
        return "?";
      }).substring(0, 60);

      doc.fontSize(10).font("Helvetica")
        .text(label, 50, doc.y, { width: 110, continued: true })
        .text(safeName, { width: 300, continued: true })
        .text(price > 0 ? price.toLocaleString() : "-", { width: 85, align: "right" });
      doc.moveDown(0.3);
    }

    // Total
    doc.moveDown(0.2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke("#aaaaaa");
    doc.moveDown(0.4);
    if (total > 0) {
      doc.fontSize(12).font("Helvetica-Bold")
        .text("Total:", 50, doc.y, { width: 410, continued: true })
        .text(`${total.toLocaleString()} KRW`, { width: 85, align: "right" });
    }

    // Footer
    doc.moveDown(1);
    doc.fontSize(8).font("Helvetica").fillColor("#888888")
      .text(`Valid until: ${new Date(build.expiresAt).toLocaleDateString("en-CA")}  |  Generated by PC Estimate Service`, { align: "center" });

    doc.end();
  } catch (err) {
    logger.error(`PDF 생성 실패: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: "PDF 생성 실패" });
  }
});

export default router;
