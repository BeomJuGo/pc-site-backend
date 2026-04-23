import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import config from "./config.js";
import { connectDB, getDB } from "./db.js";
import { connectRedisCache } from "./utils/responseCache.js";
import logger from "./utils/logger.js";
import { validate } from "./middleware/validate.js";
import { naverPriceQuerySchema, gptInfoSchema } from "./schemas/parts.js";
import { validateNaverPrice } from "./utils/priceValidator.js";

import syncCPUsRouter from "./routes/syncCPUs.js";
import syncGPUsRouter from "./routes/syncGPUs.js";
import partsRouter from "./routes/parts.js";
import recommendRouter from "./routes/recommend.js";
import syncMotherboardRouter from "./routes/syncMOTHERBOARD.js";
import syncMemoryRouter from "./routes/syncMEMORY.js";
import syncPSURouter from "./routes/syncPSU.js";
import syncCaseRouter from "./routes/syncCASE.js";
import syncCoolerRouter from "./routes/syncCOOLER.js";
import syncStorageRouter from "./routes/syncSTORAGE.js";
import buildsRouter from "./routes/builds.js";
import alertsRouter, { checkPriceAlerts } from "./routes/alerts.js";
import priceUpdateRouter from "./routes/priceUpdate.js";
import compatibilityRouter from "./routes/compatibility.js";
import pricesRouter from "./routes/prices.js";
import docsRouter from "./routes/docs.js";

const app = express();
app.set("etag", "strong");
const allowedOrigins = config.allowedOrigins;

app.use(helmet());
app.use(compression());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(`CORS 차단된 origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    exposedHeaders: ["Content-Length", "X-JSON", "X-Total-Count", "X-Page", "X-Total-Pages"],
    maxAge: 86400,
  })
);

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "잠시 후 다시 시도해주세요." },
});

const recommendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "1분에 최대 10번 요청 가능합니다." },
});

const gptInfoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "1분에 최대 10번 요청 가능합니다." },
});

const buildsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "잠시 후 다시 시도해주세요." },
});

const alertsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "잠시 후 다시 시도해주세요." },
});

const compatibilityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "잠시 후 다시 시도해주세요." },
});

const pricesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "1분에 최대 20번 요청 가능합니다." },
});

app.use("/api", apiLimiter);
app.use("/api/recommend", recommendLimiter);
app.use("/api/builds", buildsLimiter);
app.use("/api/alerts", alertsLimiter);
app.use("/api/compatibility", compatibilityLimiter);
app.use("/api/prices", pricesLimiter);

function requireAdminKey(req, res, next) {
  if (!config.adminApiKey) {
    return res.status(500).json({ error: "Server Misconfiguration", message: "ADMIN_API_KEY가 서버에 설정되지 않았습니다." });
  }
  const key = req.headers["authorization"]?.replace("Bearer ", "");
  if (key !== config.adminApiKey) {
    return res.status(401).json({ error: "Unauthorized", message: "유효하지 않은 API 키입니다." });
  }
  next();
}

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} from ${req.headers.origin || "same-origin"}`);
  next();
});

// Health and root routes always respond, even before DB is ready
app.get("/api/health", async (req, res) => {
  const db = getDB();
  let dbStatus = "disconnected";
  try {
    if (db) {
      await db.command({ ping: 1 });
      dbStatus = "connected";
    }
  } catch (_) {}
  const mem = process.memoryUsage();
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    db: dbStatus,
    memory: { rss: Math.round(mem.rss / 1024 / 1024) + "MB", heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB" },
    openai: !!config.openaiApiKey,
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "PC 추천 백엔드 API",
    status: "running",
    docs: "/api/docs",
    endpoints: ["/api/health", "/api/recommend", "/api/parts", "/api/builds", "/api/alerts", "/api/compatibility"],
  });
});

// Memoized DB initialization — safe for serverless cold starts and concurrent requests
let _initPromise = null;

function ensureInitialized() {
  if (!_initPromise) {
    _initPromise = (async () => {
      const missing = ["MONGODB_URI", "OPENAI_API_KEY", "ADMIN_API_KEY"].filter((k) => !process.env[k]);
      if (missing.length > 0) throw new Error(`필수 환경변수 누락: ${missing.join(", ")}`);
      await connectDB();
      await connectRedisCache();
    })().catch((err) => {
      _initPromise = null; // allow retry on transient failures
      throw err;
    });
  }
  return _initPromise;
}

app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (err) {
    logger.error(`초기화 실패: ${err.message}`);
    res.status(503).json({ error: "Service Unavailable", message: err.message });
  }
});

app.use("/api/docs", docsRouter);
app.use("/api/recommend", recommendRouter);
app.use("/api/admin", requireAdminKey, syncCPUsRouter);
app.use("/api/admin", requireAdminKey, syncGPUsRouter);
app.use("/api/parts", partsRouter);
app.use("/api/admin", requireAdminKey, syncMotherboardRouter);
app.use("/api/admin", requireAdminKey, syncMemoryRouter);
app.use("/api/admin", requireAdminKey, syncPSURouter);
app.use("/api/admin", requireAdminKey, syncCaseRouter);
app.use("/api/admin", requireAdminKey, syncCoolerRouter);
app.use("/api/admin", requireAdminKey, syncStorageRouter);
app.use("/api/builds", buildsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/compatibility", compatibilityRouter);
app.use("/api/prices", pricesRouter);
app.use("/api/admin", requireAdminKey, priceUpdateRouter);

// Admin trigger for price alert checks — called by GitHub Actions every 6 hours
app.post("/api/admin/check-price-alerts", requireAdminKey, (req, res) => {
  res.json({ status: "started", message: "가격 알림 체크 시작됨" });
  setImmediate(async () => {
    try {
      await checkPriceAlerts();
    } catch (err) {
      logger.error(`가격 알림 체크 실패: ${err.message}`);
    }
  });
});

app.get("/api/naver-price", validate(naverPriceQuerySchema, "query"), async (req, res) => {
  const { query, partName, referencePrice } = req.query;
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
      },
    });
    const data = await response.json();
    if (partName && data.items) {
      data.validation = validateNaverPrice(partName, data.items, referencePrice ?? null);
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

app.post("/api/gpt-info", gptInfoLimiter, validate(gptInfoSchema), async (req, res) => {
  const { partName } = req.body;

  try {
    const db = getDB();
    if (db) {
      const cached = await db.collection("parts").findOne(
        { name: partName.trim() },
        { projection: { review: 1, info: 1, specSummary: 1 } }
      );
      if (cached?.review && (cached.info || cached.specSummary)) {
        return res.json({
          review: cached.review,
          specSummary: cached.specSummary || cached.info,
        });
      }
    }
  } catch (_) {}

  const safeName = partName.trim();
  const reviewPrompt = `${safeName}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;
  const specPrompt = `${safeName}의 주요 사양을 요약해서 알려줘. 코어 수, 스레드 수, L2/L3 캐시, 베이스 클럭, 부스트 클럭 위주로 간단하게 정리해줘.`;

  try {
    const [reviewRes, specRes] = await Promise.all([
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: reviewPrompt }], max_tokens: 150, temperature: 0.7 }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: specPrompt }], max_tokens: 150, temperature: 0.7 }),
      }),
    ]);

    const reviewData = await reviewRes.json();
    const specData = await specRes.json();
    const review = reviewData.choices?.[0]?.message?.content || "한줄평 생성 실패";
    const specSummary = specData.choices?.[0]?.message?.content || "사양 요약 실패";
    res.json({ review, specSummary });
  } catch (error) {
    logger.error(`GPT 통합 요청 실패: ${error.message}`);
    res.status(500).json({ error: "GPT 정보 요청 실패" });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `경로를 찾을 수 없습니다: ${req.method} ${req.path}`,
  });
});

app.use((err, req, res, next) => {
  logger.error(`서버 에러: ${err.message}`, err);
  const isProduction = config.nodeEnv === "production";
  res.status(err.status || 500).json({
    error: isProduction ? "Internal Server Error" : (err.message || "Internal Server Error"),
    path: req.path,
    method: req.method,
  });
});

// Serverless export — Vercel and compatible platforms use this directly
export default app;
