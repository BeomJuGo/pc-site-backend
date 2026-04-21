import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import config from "./config.js";
import { connectDB, getDB } from "./db.js";
import logger from "./utils/logger.js";
import { validate } from "./middleware/validate.js";
import { naverPriceQuerySchema, gptInfoSchema } from "./schemas/parts.js";

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
import compatibilityRouter from "./routes/compatibility.js";
import docsRouter from "./routes/docs.js";

const REQUIRED_ENV = ["MONGODB_URI", "OPENAI_API_KEY", "ADMIN_API_KEY"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`❌ 필수 환경변수 누락: ${missingEnv.join(", ")}`);
  process.exit(1);
}

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

app.use("/api", apiLimiter);
app.use("/api/recommend", recommendLimiter);
app.use("/api/builds", buildsLimiter);
app.use("/api/alerts", alertsLimiter);
app.use("/api/compatibility", compatibilityLimiter);

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

app.get("/api/naver-price", validate(naverPriceQuerySchema, "query"), async (req, res) => {
  const { query } = req.query;
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
      },
    });
    const data = await response.json();
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

function setupAutoSync(cron, port, adminKey) {
  const syncRoutes = [
    "/api/admin/sync-cpus",
    "/api/admin/sync-gpus",
    "/api/admin/sync-motherboards",
    "/api/admin/sync-memory",
    "/api/admin/sync-psu",
    "/api/admin/sync-case",
    "/api/admin/sync-cooler",
    "/api/admin/sync-storage",
  ];

  cron.schedule("0 3 * * *", async () => {
    logger.info("자동 크롤링 시작");
    for (const route of syncRoutes) {
      try {
        const r = await fetch(`http://localhost:${port}${route}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${adminKey}` },
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
        logger.info(`자동 크롤링 완료: ${route} (${r.status})`);
      } catch (err) {
        logger.error(`자동 크롤링 실패: ${route} - ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 60 * 1000));
    }
    logger.info("자동 크롤링 전체 완료");
  }, { timezone: "Asia/Seoul" });

  logger.info("자동 크롤링 스케줄 등록됨 (매일 03:00 KST)");
}

async function startServer() {
  await connectDB();

  app.listen(config.port, "0.0.0.0", () => {
    logger.info(`서버 실행 중: http://localhost:${config.port}`);
    logger.info(`API 문서: http://localhost:${config.port}/api/docs`);
    logger.info(`CORS 허용 도메인: ${allowedOrigins.join(", ")}`);
  });

  setInterval(checkPriceAlerts, 6 * 60 * 60 * 1000);
  logger.info("가격 알림 체커 시작 (6시간 간격)");

  if (process.env.ENABLE_AUTO_SYNC === "true" && config.adminApiKey) {
    const { default: cron } = await import("node-cron");
    setupAutoSync(cron, config.port, config.adminApiKey);
  }
}

startServer().catch((err) => {
  logger.error(`서버 시작 실패: ${err.message}`);
  process.exit(1);
});
