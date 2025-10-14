// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./db.js";

// 기존 라우터
import syncCPUsRouter from "./routes/syncCPUs.js";
import syncGPUsRouter from "./routes/syncGPUs.js";
import partsRouter from "./routes/parts.js";
import recommendRouter from "./routes/recommend.js";
import updatePricesRouter from "./routes/updatePrices.js";
import syncMotherboardRouter from "./routes/syncMOTHERBOARD.js";
import syncMemoryRouter from "./routes/syncMEMORY.js";

// 새로 추가된 라우터
import syncPSURouter from "./routes/syncPSU.js";
import syncCaseRouter from "./routes/syncCASE.js";
import syncCoolerRouter from "./routes/syncCOOLER.js";
import syncStorageRouter from "./routes/syncSTORAGE.js";

dotenv.config();
const app = express();

// ========================================
// 🆕 CORS 설정 강화 (가장 먼저 적용)
// ========================================
const allowedOrigins = [
  "https://goodpricepc.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

// 🆕 1. 기본 CORS 미들웨어 (모든 요청에 적용)
app.use(
  cors({
    origin: function (origin, callback) {
      // origin이 없는 경우 (같은 도메인, Postman 등) 허용
      if (!origin) {
        return callback(null, true);
      }
      
      // 허용된 origin인 경우
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // 그 외의 경우
      console.log("❌ CORS 차단된 origin:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allowedHeaders: [
      "Content-Type", 
      "Authorization", 
      "X-Requested-With",
      "Accept",
      "Origin"
    ],
    exposedHeaders: ["Content-Length", "X-JSON"],
    maxAge: 86400, // 24시간 동안 preflight 결과 캐싱
  })
);

// 🆕 2. OPTIONS preflight 요청 명시적 처리
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    return res.status(204).send();
  }
  return res.status(403).send("Forbidden");
});

// 🆕 3. 추가 CORS 헤더 (안전장치)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  next();
});

// JSON 파싱 미들웨어
app.use(express.json());

// 🆕 4. 요청 로깅 (디버깅용)
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} from ${req.headers.origin || 'same-origin'}`);
  next();
});

// ========================================
// 라우트 등록
// ========================================
app.use("/api/admin", syncCPUsRouter);
app.use("/api/admin", syncGPUsRouter);
app.use("/api/parts", partsRouter);
app.use("/api/recommend", recommendRouter); // 🔴 이 경로 확인
app.use("/api/admin", updatePricesRouter);
app.use("/api", syncMotherboardRouter);
app.use("/api", syncMemoryRouter);
app.use("/api", syncPSURouter);
app.use("/api", syncCaseRouter);
app.use("/api", syncCoolerRouter);
app.use("/api", syncStorageRouter);

// ========================================
// 네이버 가격 + 이미지 API
// ========================================
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

app.get("/api/naver-price", async (req, res) => {
  const query = encodeURIComponent(req.query.query);
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${query}`;

  try {
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ========================================
// GPT 정보 API
// ========================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/api/gpt-info", async (req, res) => {
  const { partName } = req.body;

  const reviewPrompt = `${partName}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;
  const specPrompt = `${partName}의 주요 사양을 요약해서 알려줘. 코어 수, 스레드 수, L2/L3 캐시, 베이스 클럭, 부스트 클럭 위주로 간단하게 정리해줘. 예시: 코어: 6, 스레드: 12, ...`;

  try {
    const [reviewRes, specRes] = await Promise.all([
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: reviewPrompt }],
          max_tokens: 150,
          temperature: 0.7,
        }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
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

// ========================================
// 🆕 헬스 체크 엔드포인트 (Wake-up용)
// ========================================
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cors: "enabled",
    allowedOrigins,
    routes: {
      basic: ["cpu", "gpu", "motherboard", "memory"],
      new: ["psu", "case", "cooler", "storage"]
    }
  });
});

// 🆕 루트 경로 헬스 체크
app.get("/", (req, res) => {
  res.json({
    message: "PC 추천 백엔드 API",
    status: "running",
    endpoints: [
      "/api/health",
      "/api/recommend",
      "/api/parts",
      "/api/admin/sync-cpus",
      "/api/admin/sync-gpus"
    ]
  });
});

// ========================================
// 🆕 에러 핸들러
// ========================================
app.use((err, req, res, next) => {
  console.error("❌ 서버 에러:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    path: req.path,
    method: req.method
  });
});

// ========================================
// DB 연결 후 서버 시작
// ========================================
connectDB().then(() => {
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
    console.log(`🌐 CORS 허용 도메인:`, allowedOrigins);
    console.log(`📦 등록된 sync 라우터: CPU, GPU, Motherboard, Memory, PSU, Case, Cooler, Storage`);
  });
}).catch(err => {
  console.error("❌ MongoDB 연결 실패:", err);
  process.exit(1);
});
