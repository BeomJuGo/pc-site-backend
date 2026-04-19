// index.js
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import config from "./config.js";
import { connectDB } from "./db.js";

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
import backfillImageRouter from "./routes/backfillImage.js";
import backfillBenchmarkRouter from "./routes/backfillBenchmark.js";

const app = express();
const allowedOrigins = config.allowedOrigins;

// CORS (단일 미들웨어로 통합)
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.log("❌ CORS 차단된 origin:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    exposedHeaders: ["Content-Length", "X-JSON"],
    maxAge: 86400,
  })
);

app.use(express.json());

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "잌시 후 다시 시도해주세요." },
});

const recommendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "1분에 최대 10번 요청 가능합니다." },
});

app.use("/api", apiLimiter);
app.use("/api/recommend", recommendLimiter);

// Admin 인증 미들웨어
function requireAdminKey(req, res, next) {
  if (!config.adminApiKey) {
    console.warn("⚠️ ADMIN_API_KEY 미설정 - admin 엔드포인트가 보호되지 않습니다");
    return next();
  }
  const key = req.headers["authorization"]?.replace("Bearer ", "");
  if (key !== config.adminApiKey) {
    return res.status(401).json({ error: "Unauthorized", message: "유효하지 않은 API 키입니다." });
  }
  next();
}

// 요청 로깅
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} from ${req.headers.origin || "same-origin"}`);
  next();
});

// 헬스 체크
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cors: "enabled",
    allowedOrigins,
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "PC 추천 백엔드 API",
    status: "running",
    endpoints: ["/api/health", "/api/recommend", "/api/parts"],
  });
});

// 라우트 등록
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
app.use("/api/admin", requireAdminKey, backfillImageRouter);
app.use("/api/admin", requireAdminKey, backfillBenchmarkRouter);

// 네이버 가격 API
app.get("/api/naver-price", async (req, res) => {
  const { query } = req.query;
  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "query 파라미터가 필요합니다." });
  }
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

// GPT 정보 API
app.post("/api/gpt-info", async (req, res) => {
  const { partName } = req.body;
  if (!partName || typeof partName !== "string" || partName.trim() === "") {
    return res.status(400).json({ error: "partName이 필요합니다." });
  }

  const reviewPrompt = `${partName}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;
  const specPrompt = `${partName}의 주요 사양을 요약해서 알려줘. 코어 수, 스레드 수, L2/L3 캐시, 베이스 클럭, 부스트 클럭 위주로 간단하게 정리해줘. 예시: 코어: 6, 스레드: 12, ...`;

  try {
    const [reviewRes, specRes] = await Promise.all([
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: reviewPrompt }],
          max_tokens: 150,
          temperature: 0.7,
        }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: specPrompt }],
          max_tokens: 150,
          temperature: 0.7,
        }),
      }),
    ]);

    const reviewData = await reviewRes.json();
    const specData = await specRes.json();

    const review = reviewData.choices?.[0]?.message?.content || "한줄평 생성 실패";
    const specSummary = specData.choices?.[0]?.message?.content || "사양 요약 실패";

    res.json({ review, specSummary });
  } catch (error) {
    console.error("❌ GPT 통합 요청 실패:", error.message);
    res.status(500).json({ error: "GPT 정보 요청 실패" });
  }
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `경로를 찾을 수 없습니다: ${req.method} ${req.path}`,
    availableRoutes: [
      "GET /",
      "GET /api/health",
      "GET /api/parts",
      "POST /api/recommend",
      "POST /api/admin/sync-cpus",
      "POST /api/admin/sync-gpus",
      "POST /api/admin/sync-motherboards",
      "POST /api/admin/sync-memory",
      "POST /api/admin/sync-psu",
      "POST /api/admin/sync-case",
      "POST /api/admin/sync-cooler",
      "POST /api/admin/sync-storage",
    ],
  });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error("❌ 서버 에러:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    path: req.path,
    method: req.method,
  });
});

// DB 연결 후 서버 시작
connectDB().then(() => {
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`✅ 서버 실행 중: http://localhost:${config.port}`);
    console.log(`🌐 CORS 허용 도메인:`, allowedOrigins);
  });
}).catch(err => {
  console.error("❌ MongoDB 연결 실패:", err);
  process.exit(1);
});
