import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();

const allowedOrigins = ["https://goodpricepc.vercel.app"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.split("/")[0] + "//" + origin.split("/")[2];
      if (allowedOrigins.includes(cleanOrigin)) {
        callback(null, true);
      } else {
        console.warn(`❌ CORS 차단됨: ${origin}`);
        callback(new Error("CORS 차단: " + origin));
      }
    },
  })
);

app.use(express.json());

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 네이버 쇼핑 가격 API
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
    if (!response.ok) throw new Error(`ㅇㅎ 오류: ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("❌ 네이버 쇼핑 API 요청 오류:", error);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// GPT 한줄평 프록시 API
app.post("/api/gpt-review", async (req, res) => {
  const { partName } = req.body;
  const prompt = `${partName}의 특징을 간단히 요약한 한줄평을 만들어줘.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const review = data.choices?.[0]?.message?.content || "한줄평 생성 실패";
    res.json({ review });
  } catch (error) {
    console.error("❌ GPT API 요청 오류:", error);
    res.status(500).json({ error: "GPT API 요청 실패" });
  }
});

// Geekbench 벤치마크 점수 크롤링
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = "https://browser.geekbench.com/processor-benchmarks";
    console.log(`🔍 [Geekbench 페이지 요청] ${url}`);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    let single = null;
    let multi = null;

    $("table tbody tr").each((_, row) => {
      const name = $(row).find("td").eq(0).text().trim();
      const score = $(row).find("td").eq(1).text().trim();

      if (name.toLowerCase().includes(cpuName.toLowerCase())) {
        if (!single) single = score;
        else multi = score;
      }
    });

    if (!single || !multi) throw new Error(`점수 추출 실패 (Single: ${single}, Multi: ${multi})`);

    return { singleCore: single, multiCore: multi };
  } catch (error) {
    console.error(`❌ [CPU 벤치마크 에러] ${cpuName}:`, error.message);
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};

// CPU 벤치마크 API
app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  if (!cpuName) return res.status(400).json({ error: "CPU 이름이 필요합니다." });
  const score = await fetchCpuBenchmark(cpuName);
  res.json({ cpu: cpuName, benchmarkScore: score });
});

// GPU 미지원
app.get("/api/gpu-benchmark", async (req, res) => {
  const gpuName = req.query.gpu;
  if (!gpuName) return res.status(400).json({ error: "GPU 이름이 필요합니다." });
  res.json({ gpu: gpuName, benchmarkScore: "지원 예정" });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
