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

// ============================================================
// GPT 부품 정보 프롬프트 빌더
// ============================================================
function buildGptPrompts(partName) {
  const reviewPrompt = `당신은 PC 부품 전문 리뷰어입니다. 반드시 이 특정 제품(${partName})에만 해당하는 한줄평을 작성하세요.\n\n규칙:\n- 이 제품 고유의 특징에 근거한 구체적인 장점 1가지 (수치, 성능 포지션, 설계 특성 등 포함)\n- 이 제품의 실제 한계나 단점 1가지 (구체적으로)\n- \"성능이 좋다\", \"가격이 합리적이다\", \"가성비가 뛰어나다\" 같은 모든 제품에 해당하는 범용 표현 절대 금지\n- 반드시 이 모델명에만 해당하는 내용으로 작성\n형식(다른 텍스트 없이): 장점: [내용], 단점: [내용]`;

  const specPrompt = `${partName}의 핵심 사양을 한 줄로 정리하세요.\n\nCPU이면: 코어/스레드 수, 베이스/부스트 클럭(GHz), L3 캐시(MB), TDP(W), 소켓\nGPU이면: VRAM 용량과 규격, 부스트 클럭(MHz), TDP(W), 출력 단자 종류\n메모리면: 용량(GB), DDR 규격, 속도(MHz), CAS 레이턴시\n저장장치면: 용량, 인터페이스(NVMe/SATA), 순차읽기/쓰기 속도(MB/s)\n메인보드면: 소켓, 칩셋, 지원 메모리 규격, 폼팩터\n파워면: 정격 출력(W), 80PLUS 등급, 모듈러 여부\n쿨러면: 방식(공낙/수낙), 팔 크기/개수, 지원 소켓, TDP 지원\n케이스면: 폼팩터, 지원 메인보드 크기, 팔/라이저 슬롯 수\n\n쉼표로 구분하여 한 줄로만 작성 (줄바바싸 없음)`;

  return { reviewPrompt, specPrompt };
}

async function callGptInfo(partName, model) {
  const { reviewPrompt, specPrompt } = buildGptPrompts(partName);
  const useCompletionTokens = model !== "gpt-4o-mini";
  const tokenParam = useCompletionTokens ? { max_completion_tokens: 200 } : { max_tokens: 200 };

  const [reviewRes, specRes] = await Promise.all([
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: reviewPrompt }], temperature: 0.4, ...tokenParam }),
    }),
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: specPrompt }], temperature: 0.2, ...tokenParam }),
    }),
  ]);

  const reviewData = await reviewRes.json();
  const specData = await specRes.json();

  if (!reviewRes.ok) throw new Error(reviewData?.error?.message || `review API 오류 ${reviewRes.status}`);
  if (!specRes.ok) throw new Error(specData?.error?.message || `spec API 오류 ${specRes.status}`);

  return {
    review: reviewData.choices?.[0]?.message?.content?.trim() || "한줄평 생성 실패",
    specSummary: specData.choices?.[0]?.message?.content?.trim() || "사양 요약 실패",
    usage: {
      reviewTokens: reviewData.usage?.total_tokens || 0,
      specTokens: specData.usage?.total_tokens || 0,
    },
  };
}

// 부품 한줄평 + 사양 요약 (gpt-5.4 — MongoDB 캐시로 부품당 1회만 호출)
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
        return res.json({ review: cached.review, specSummary: cached.specSummary || cached.info });
      }
    }
  } catch (_) {}

  try {
    const { review, specSummary } = await callGptInfo(partName.trim(), "gpt-5.4");
    res.json({ review, specSummary });
  } catch (error) {
    logger.error(`GPT 통합 요청 실패: ${error.message}`);
    res.status(500).json({ error: "GPT 정보 요청 실패" });
  }
});

// 3모델 비교 테스트 (어드민 전용)
app.post("/api/gpt-info-compare", requireAdminKey, async (req, res) => {
  const { partName } = req.body;
  if (!partName || typeof partName !== "string" || partName.trim().length < 1) {
    return res.status(400).json({ error: "partName이 필요합니다." });
  }
  const MODELS = ["gpt-4o-mini", "gpt-5.4-mini", "gpt-5.4"];
  try {
    const results = await Promise.all(
      MODELS.map(async (model) => {
        try {
          const result = await callGptInfo(partName.trim(), model);
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

// Start server for Render/traditional hosting; Vercel uses the exported app directly
const PORT = config.port;
app.listen(PORT, () => {
  logger.info(`서버 실행 중: 포트 ${PORT}`);
});

export default app;
