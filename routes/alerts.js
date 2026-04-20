// routes/alerts.js - 가격 알림 (Feature 2)
import express from "express";
import { getDB } from "../db.js";
import { ObjectId } from "mongodb";

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
      html: `<h2>\uac00\uaca9 \ud558\ub77d \uc54c\ub9bc</h2>
<p><strong>${partName}</strong>\uc758 \uac00\uaca9\uc774 \ubaa9\ud45c \uac00\uaca9 \uc774\ud558\ub85c \ub0b4\ub824\uc654\uc2b5\ub2c8\ub2e4.</p>
<p>\ubaa9\ud45c \uac00\uaca9: ${targetPrice.toLocaleString()}\uc6d0</p>
<p>\ud604\uc7ac \uac00\uaca9: <strong style="color:red">${currentPrice.toLocaleString()}\uc6d0</strong></p>`,
    });
    console.log(`\uD83D\uDCE7 \uac00\uaca9 \uc54c\ub9bc \ubc1c\uc1a1: ${to}`);
  } catch (err) {
    console.error("\u274C \uc774\uba54\uc77c \ubc1c\uc1a1 \uc2e4\ud328:", err.message);
  }
}

// POST /api/alerts - 가격 알림 등록
router.post("/", async (req, res) => {
  try {
    const { category, name, targetPrice, email } = req.body;
    if (!category || !name || !targetPrice || !email)
      return res.status(400).json({ error: "category, name, targetPrice, email\uc774 \ubaa8\ub450 \ud544\uc694\ud569\ub2c8\ub2e4." });
    if (typeof targetPrice !== "number" || targetPrice <= 0)
      return res.status(400).json({ error: "targetPrice\ub294 \uc591\uc218\uc5ec\uc57c \ud569\ub2c8\ub2e4." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "\uc720\ud6a8\ud558\uc9c0 \uc54a\uc740 \uc774\uba54\uc77c \ud615\uc2dd\uc785\ub2c8\ub2e4." });

    const db = getDB();
    const existing = await db.collection("price_alerts").findOne({ category, name, email, triggered: false });
    if (existing) return res.status(409).json({ error: "\uc774\ubbf8 \ub3d9\uc77c\ud55c \uc54c\ub9bc\uc774 \ub4f1\ub85d\ub418\uc5b4 \uc788\uc2b5\ub2c8\ub2e4." });

    const result = await db.collection("price_alerts").insertOne({
      category, name, targetPrice, email,
      createdAt: new Date(),
      triggered: false,
      triggeredAt: null,
      triggeredPrice: null,
    });

    res.json({ id: result.insertedId, message: "\uac00\uaca9 \uc54c\ub9bc\uc774 \ub4f1\ub85d\ub418\uc5c8\uc2b5\ub2c8\ub2e4." });
  } catch (err) {
    res.status(500).json({ error: "\uc54c\ub9bc \ub4f1\ub85d \uc2e4\ud328" });
  }
});

// GET /api/alerts?email=xxx - 내 알림 목록
router.get("/", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "email \ud30c\ub77c\ubbf8\ud130\uac00 \ud544\uc694\ud569\ub2c8\ub2e4." });
    const db = getDB();
    const alerts = await db.collection("price_alerts").find({ email }).sort({ createdAt: -1 }).toArray();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: "\uc54c\ub9bc \ubaa9\ub85d \uc870\ud68c \uc2e4\ud328" });
  }
});

// DELETE /api/alerts/:id - 알림 삭제
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "\uc720\ud6a8\ud558\uc9c0 \uc54a\uc740 ID\uc785\ub2c8\ub2e4." });
    const db = getDB();
    const result = await db.collection("price_alerts").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "\uc54c\ub9bc\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4." });
    res.json({ message: "\uc54c\ub9bc\uc774 \uc0ad\uc81c\ub418\uc5c8\uc2b5\ub2c8\ub2e4." });
  } catch (err) {
    res.status(500).json({ error: "\uc54c\ub9bc \uc0ad\uc81c \uc2e4\ud328" });
  }
});

// 내부 함수: sync 완료 후 또는 주기적으로 호출
export async function checkPriceAlerts() {
  try {
    const db = getDB();
    if (!db) return;
    const alerts = await db.collection("price_alerts").find({ triggered: false }).toArray();
    if (alerts.length === 0) return;
    console.log(`\uD83D\uDD14 \uac00\uaca9 \uc54c\ub9bc \uccb4\ud06c: ${alerts.length}\uac1c`);
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
      console.log(`\uD83D\uDD14 \uc54c\ub9bc \ud2b8\ub9ac\uac70: ${alert.name} (${part.price.toLocaleString()}\uc6d0)`);
    }
  } catch (err) {
    console.error("\u274C \uac00\uaca9 \uc54c\ub9bc \uccb4\ud06c \uc2e4\ud328:", err);
  }
}

export default router;
