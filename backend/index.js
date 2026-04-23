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
import { callGptInfo } from "./utils/gptInfo.js";

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
import adminMaintenanceRouter from "./routes/adminMaintenance.js";

const app = express();
app.set("etag", "strong");
app.set("trust proxy", 1);
const allowedOrigins = config.allowedOrigins;

app.use(helmet());
app.use(compression());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(`CORS 전당된주 origin: ${origin}`);
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

const SKIP_LOG_PATHS = new Set(["/api/health", "/favicon.ico"]);
app.use((req, res, next) => {
  if (!SKIP_LOG_PATHS.has(req.path)) {
    logger.info(`${req.method} ${req.path} from ${req.headers.origin || "same-origin"}`);
  }
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
    message: "PC 추첸 백엔드 API",
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
app.use("/api/admin", requireAdminKey, adminMaintenanceRouter);
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

// callGptInfo는 utils/gptInfo.js에서 import

// 부품 한줄평 + 사양 요약 (gpt-5.4 — MongoDB에 캐시, 부품당 1회 생성)
app.post("/api/gpt-info", gptInfoLimiter, validate(gptInfoSchema), async (req, res) => {
  const { partName } = req.body;
  const name = partName.trim();

  const db = getDB();
  let category = null;

  try {
    if (db) {
      const part = await db.collection("parts").findOne(
        { name },
        { projection: { review: 1, specSummary: 1, info: 1, category: 1 } }
      );
      category = part?.category || null;
      // specSummary(새 구조화 형식)가 있어야 캐시로 인정 — "항목명: 값" 형식("/")이 3개 이상 있어야 유효
      const isValidSpec = (s) => typeof s === "string" && (s.match(/\//g) || []).length >= 2;
      if (part?.review && isValidSpec(part?.specSummary)) {
        return res.json({ review: part.review, specSummary: part.specSummary });
      }
    }
  } catch (_) {}

  try {
    const { review, specSummary } = await callGptInfo(name, category, "gpt-5.4", config.openaiApiKey);
    // 형식이 유효할 때만 DB에 저장 (숫자만 나열된 불량 스펙은 캐시 안 함)
    const isValidSpec = (s) => typeof s === "string" && (s.match(/\//g) || []).length >= 2;
    if (db && isValidSpec(specSummary)) {
      db.collection("parts")
        .updateOne({ name }, { $set: { review, specSummary, specUpdatedAt: new Date().toISOString() } })
        .catch((e) => logger.error(`gpt-info DB 저장 실패: ${e.message}`));
    }
    res.json({ review, specSummary });
  } catch (error) {
    logger.error(`GPT 정보 요청 실패: ${error.message}`);
    res.status(500).json({ error: "GPT 정보 요청 실패" });
  }
});

// 3모델 비교 테스트 (어드민 전용)
app.post("/api/gpt-info-compare", requireAdminKey, async (req, res) => {
  const { partName } = req.body;
  if (!partName || typeof partName !== "string" || partName.trim().length < 1) {
    return res.status(400).json({ error: "partName이 필요합니다." });
  }
  const db = getDB();
  let category = null;
  try {
    if (db) {
      const part = await db.collection("parts").findOne({ name: partName.trim() }, { projection: { category: 1 } });
      category = part?.category || null;
    }
  } catch (_) {}

  const MODELS = ["gpt-4o-mini", "gpt-5.4-mini", "gpt-5.4"];
  try {
    const results = await Promise.all(
      MODELS.map(async (model) => {
        try {
          const result = await callGptInfo(partName.trim(), category, model, config.openaiApiKey);
          return { model, ...result, error: null };
        } catch (e) {
          return { model, review: null, specSummary: null, usage: null, error: e.message };
        }
      })
    );
    res.json({ partName: partName.trim(), results });
  } catch (error) {
    logger.error(`gpt-info-compare 실패: ${error.message}`);
    res.status(500).json({ error: error.message });
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

// Start server only outside Vercel (Render, local dev)
if (!process.env.VERCEL) {
  const PORT = config.port;
  app.listen(PORT, () => {
    logger.info(`서버 실행 중: 포트 ${PORT}`);
  });
}

export default app;
