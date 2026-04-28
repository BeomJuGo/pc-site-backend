// routes/webhooks.js — n8n 연동 엔드포인트
import express from "express";
import { getDB } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

function requireWebhookSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return next(); // 미설정 시 개발 환경으로 간주 통과
  if (req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export async function forwardToN8n(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    logger.info(`n8n 웹훅 전송: ${webhookUrl.slice(0, 60)}...`);
  } catch (err) {
    logger.warn(`n8n 웹훅 전송 실패: ${err.message}`);
  }
}

// POST /api/webhooks/alert-created — 알림 등록 즉시 체크 트리거
router.post("/alert-created", requireWebhookSecret, async (req, res) => {
  const { category, name, targetPrice, email } = req.body;
  if (!category || !name || !targetPrice || !email) {
    return res.status(400).json({ error: "category, name, targetPrice, email 필수" });
  }
  res.json({ status: "received" });
  forwardToN8n(process.env.N8N_ALERT_WEBHOOK, { category, name, targetPrice, email });
});

// POST /api/webhooks/price-update-done — 가격 업데이트 완료 알림
router.post("/price-update-done", requireWebhookSecret, (req, res) => {
  res.json({ status: "received" });
  forwardToN8n(process.env.N8N_PRICE_DONE_WEBHOOK, req.body);
});

// GET /api/webhooks/insights — 일일 인사이트 데이터 (n8n Workflow 4 호출용)
router.get("/insights", requireWebhookSecret, async (req, res) => {
  try {
    const db = getDB();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    const [priceDrop, triggeredAlerts, cachedSetsCount] = await Promise.all([
      // 최근 24시간 기준 가격 하락 TOP 5
      db.collection("parts").aggregate([
        { $match: { price: { $gt: 0 }, priceHistory: { $exists: true, $not: { $size: 0 } } } },
        {
          $addFields: {
            recentEntry: {
              $filter: { input: "$priceHistory", cond: { $gte: ["$$this.date", yesterdayStr] } },
            },
            baseEntries: {
              $filter: { input: "$priceHistory", cond: { $lt: ["$$this.date", yesterdayStr] } },
            },
          },
        },
        { $match: { "recentEntry.0": { $exists: true }, "baseEntries.0": { $exists: true } } },
        {
          $addFields: {
            avgBase: { $avg: "$baseEntries.price" },
          },
        },
        {
          $addFields: {
            dropPct: {
              $multiply: [
                { $divide: [{ $subtract: ["$avgBase", "$price"] }, "$avgBase"] },
                100,
              ],
            },
          },
        },
        { $match: { dropPct: { $gt: 0 } } },
        { $sort: { dropPct: -1 } },
        { $limit: 5 },
        { $project: { name: 1, category: 1, price: 1, dropPct: { $round: ["$dropPct", 1] } } },
      ]).toArray(),

      // 최근 24시간 트리거된 알림 수
      db.collection("price_alerts").countDocuments({
        triggered: true,
        triggeredAt: { $gte: yesterday },
      }),

      // 유효한 AI 캐시 수
      db.collection("cached_sets_v2").countDocuments(),
    ]);

    res.json({
      date: todayStr,
      priceDrop,
      triggeredAlerts,
      cachedSets: cachedSetsCount,
      totalBudgets: 16,
    });
  } catch (err) {
    logger.error(`insights 조회 실패: ${err.message}`);
    res.status(500).json({ error: "insights 조회 실패" });
  }
});

export default router;
