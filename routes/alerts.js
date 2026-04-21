// routes/alerts.js - 가격 알림 (Feature 2)
import express from "express";
import { getDB } from "../db.js";
import { ObjectId } from "mongodb";
import logger from "../utils/logger.js";
import { validate } from "../middleware/validate.js";
import { createAlertSchema, getAlertsQuerySchema } from "../schemas/alerts.js";

const router = express.Router();

async function sendAlertEmail(to, partName, targetPrice, currentPrice) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return;
  try {
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transporter.sendMail({
      from: smtpUser,
      to,
      subject: `[PC견적] ${partName} 가격 알림`,
      html: `<h2>가격 하락 알림</h2>
<p><strong>${partName}</strong>의 가격이 목표 가격 이하로 내려왔습니다.</p>
<p>목표 가격: ${targetPrice.toLocaleString()}원</p>
<p>현재 가격: <strong style="color:red">${currentPrice.toLocaleString()}원</strong></p>`,
    });
    logger.info(`가격 알림 발송: ${to}`);
  } catch (err) {
    logger.error(`이메일 발송 실패: ${err.message}`);
  }
}

// POST /api/alerts - 가격 알림 등록
router.post("/", validate(createAlertSchema), async (req, res) => {
  try {
    const { category, name, targetPrice, email } = req.body;

    const db = getDB();
    const existing = await db.collection("price_alerts").findOne({ category, name, email, triggered: false });
    if (existing) return res.status(409).json({ error: "이미 동일한 알림이 등록되어 있습니다." });

    const result = await db.collection("price_alerts").insertOne({
      category, name, targetPrice, email,
      createdAt: new Date(),
      triggered: false,
      triggeredAt: null,
      triggeredPrice: null,
    });

    res.json({ id: result.insertedId, message: "가격 알림이 등록되었습니다." });
  } catch (err) {
    res.status(500).json({ error: "알림 등록 실패" });
  }
});

// GET /api/alerts?email=xxx - 내 알림 목록
router.get("/", validate(getAlertsQuerySchema, "query"), async (req, res) => {
  try {
    const { email } = req.query;
    const db = getDB();
    const alerts = await db.collection("price_alerts").find({ email }).sort({ createdAt: -1 }).toArray();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: "알림 목록 조회 실패" });
  }
});

// DELETE /api/alerts/:id - 알림 삭제
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "유효하지 않은 ID입니다." });
    const db = getDB();
    const result = await db.collection("price_alerts").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "알림을 찾을 수 없습니다." });
    res.json({ message: "알림이 삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: "알림 삭제 실패" });
  }
});

export async function checkPriceAlerts() {
  try {
    const db = getDB();
    if (!db) return;
    const alerts = await db.collection("price_alerts").find({ triggered: false }).toArray();
    if (alerts.length === 0) return;
    logger.info(`가격 알림 체크: ${alerts.length}개`);
    for (const alert of alerts) {
      const part = await db.collection("parts").findOne(
        { category: alert.category, name: alert.name },
        { projection: { price: 1 } }
      );
      if (!part || part.price > alert.targetPrice) continue;
      await db.collection("price_alerts").updateOne(
        { _id: alert._id },
        { $set: { triggered: true, triggeredAt: new Date(), triggeredPrice: part.price } }
      );
      await sendAlertEmail(alert.email, alert.name, alert.targetPrice, part.price);
      logger.info(`알림 트리거: ${alert.name} (${part.price.toLocaleString()}원)`);
    }
  } catch (err) {
    logger.error(`가격 알림 체크 실패: ${err.message}`);
  }
}

export default router;
