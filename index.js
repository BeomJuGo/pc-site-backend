// index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import config from "./config.js";
import { connectDB, getDB } from "./db.js";

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

const app = express();
const allowedOrigins = config.allowedOrigins;

app.use(helmet());
app.use(compression());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.log("\u274C CORS \ucc28\ub2e8\ub41c origin:", origin);
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
  message: { error: "Too Many Requests", message: "\uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694." },
});

const recommendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "1\ubd84\uc5d0 \ucd5c\ub300 10\ubc88 \uc694\uccad \uac00\ub2a5\ud569\ub2c8\ub2e4." },
});

const gptInfoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "1\ubd84\uc5d0 \ucd5c\ub300 10\ubc88 \uc694\uccad \uac00\ub2a5\ud569\ub2c8\ub2e4." },
});

app.use("/api", apiLimiter);
app.use("/api/recommend", recommendLimiter);

function requireAdminKey(req, res, next) {
  if (!config.adminApiKey) {
    return res.status(500).json({ error: "Server Misconfiguration", message: "ADMIN_API_KEY\uac00 \uc11c\ubc84\uc5d0 \uc124\uc815\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4." });
  }
  const key = req.headers["authorization"]?.replace("Bearer ", "");
  if (key !== config.adminApiKey) {
    return res.status(401).json({ error: "Unauthorized", message: "\uc720\ud6a8\ud558\uc9c0 \uc54a\uc740 API \ud0a4\uc785\ub2c8\ub2e4." });
  }
  next();
}

app.use((req, res, next) => {
  console.log(`\uD83D\uDCE5 ${req.method} ${req.path} from ${req.headers.origin || "same-origin"}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "PC \ucd94\ucc9c \ubc31\uc5d4\ub4dc API",
    status: "running",
    endpoints: ["/api/health", "/api/recommend", "/api/parts", "/api/builds", "/api/alerts", "/api/compatibility"],
  });
});

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

app.get("/api/naver-price", async (req, res) => {
  const { query } = req.query;
  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "query \ud30c\ub77c\ubbf8\ud130\uac00 \ud544\uc694\ud569\ub2c8\ub2e4." });
  }
  if (query.length > 200) {
    return res.status(400).json({ error: "query\uac00 \ub108\ubb34 \uae38\uc2b5\ub2c8\ub2e4. (\ucd5c\ub300 200\uc790)" });
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
    res.status(500).json({ error: "\ub124\uc774\ubc84 API \uc694\uccad \uc2e4\ud328" });
  }
});

app.post("/api/gpt-info", gptInfoLimiter, async (req, res) => {
  const { partName } = req.body;
  if (!partName || typeof partName !== "string" || partName.trim() === "") {
    return res.status(400).json({ error: "partName\uc774 \ud544\uc694\ud569\ub2c8\ub2e4." });
  }
  if (partName.length > 200) {
    return res.status(400).json({ error: "partName\uc774 \ub108\ubb34 \uae38\ub2c8\ub2e4. (\ucd5c\ub300 200\uc790)" });
  }

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
  const reviewPrompt = `${safeName}\uc758 \uc7a5\uc810\uacfc \ub2e8\uc810\uc744 \uac01\uac01 \ud55c \ubb38\uc7a5\uc73c\ub85c \uc54c\ub824\uc918. \ud615\uc2dd\uc740 '\uc7a5\uc810: ..., \ub2e8\uc810: ...'\uc73c\ub85c \ud574\uc918.`;
  const specPrompt = `${safeName}\uc758 \uc8fc\uc694 \uc0ac\uc591\uc744 \uc694\uc57d\ud574\uc11c \uc54c\ub824\uc918. \ucf54\uc5b4 \uc218, \uc2a4\ub808\ub4dc \uc218, L2/L3 \uce90\uc2dc, \ubca0\uc774\uc2a4 \ud074\ub7ed, \ubd80\uc2a4\ud2b8 \ud074\ub7ed \uc704\uc8fc\ub85c \uac04\ub2e8\ud558\uac8c \uc815\ub9ac\ud574\uc918.`;

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
    const review = reviewData.choices?.[0]?.message?.content || "\ud55c\uc904\ud3c9 \uc0dd\uc131 \uc2e4\ud328";
    const specSummary = specData.choices?.[0]?.message?.content || "\uc0ac\uc591 \uc694\uc57d \uc2e4\ud328";
    res.json({ review, specSummary });
  } catch (error) {
    console.error("\u274C GPT \ud1b5\ud569 \uc694\uccad \uc2e4\ud328:", error.message);
    res.status(500).json({ error: "GPT \uc815\ubcf4 \uc694\uccad \uc2e4\ud328" });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `\uacbd\ub85c\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4: ${req.method} ${req.path}`,
    availableRoutes: [
      "GET /", "GET /api/health",
      "GET /api/parts", "GET /api/parts/value-rank?category=gpu",
      "GET /api/parts/budget-picks?budget=1000000",
      "POST /api/parts/batch", "GET /api/parts/danawa-url?name=...",
      "GET /api/parts/:category/:name", "GET /api/parts/:category/:name/history",
      "POST /api/recommend",
      "POST /api/builds", "GET /api/builds/:shareId",
      "POST /api/alerts", "GET /api/alerts?email=...", "DELETE /api/alerts/:id",
      "POST /api/compatibility/check",
      "POST /api/admin/sync-cpus", "POST /api/admin/sync-gpus",
      "POST /api/admin/sync-motherboards", "POST /api/admin/sync-memory",
      "POST /api/admin/sync-psu", "POST /api/admin/sync-case",
      "POST /api/admin/sync-cooler", "POST /api/admin/sync-storage",
    ],
  });
});

app.use((err, req, res, next) => {
  console.error("\u274C \uc11c\ubc84 \uc5d0\ub7ec:", err);
  const isProduction = config.nodeEnv === "production";
  res.status(err.status || 500).json({
    error: isProduction ? "Internal Server Error" : (err.message || "Internal Server Error"),
    path: req.path,
    method: req.method,
  });
});

connectDB().then(() => {
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`\u2705 \uc11c\ubc84 \uc2e4\ud589 \uc911: http://localhost:${config.port}`);
    console.log(`\uD83C\uDF10 CORS \ud5c8\uc6a9 \ub3c4\uba54\uc778:`, allowedOrigins);
  });

  // \uac00\uaca9 \uc54c\ub9bc \ccb4\ud06c - 6\uc2dc\uac04\ub9c8\ub2e4
  setInterval(checkPriceAlerts, 6 * 60 * 60 * 1000);
  console.log("\uD83D\uDD14 \uac00\uaca9 \uc54c\ub9bc \uccb4\ucee4 \uc2dc\uc791 (6\uc2dc\uac04 \uac04\uaca9)");
}).catch(err => {
  console.error("\u274C MongoDB \uc5f0\uacb0 \uc2e4\ud328:", err);
  process.exit(1);
});
