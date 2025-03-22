// ✅ index.js (백엔드 전체 코드 - /api/part-detail 및 /api/price-history 포함)

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();
const allowedOrigins = ["https://goodpricepc.vercel.app"];

app.use(cors({
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
}));

app.use(express.json());

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 네이버 가격 API
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
    if (!response.ok) throw new Error(`네이버 API 오류: ${response.statusText}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("❌ 네이버 쇼핑 API 요청 오류:", error);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ✅ GPT 한줄평 API
app.post("/api/gpt-review", async (req, res) => {
  const { partName } = req.body;
  const prompt = `${partName}의 장단점을 한줄평으로 짧게 적어 줘`;

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

// ✅ Geekbench CPU 벤치마크 크롤링
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = `https://browser.geekbench.com/processor-benchmarks`;
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    let scores = [];

    $("table tbody tr").each((_, row) => {
      const name = $(row).find("td").eq(0).text().trim();
      const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
      if (name.toLowerCase().includes(cpuName.toLowerCase()) && !isNaN(score)) {
        scores.push(score);
      }
    });

    if (scores.length === 0) throw new Error("CPU 점수를 찾을 수 없습니다.");

    const singleCore = Math.min(...scores).toString();
    const multiCore = Math.max(...scores).toString();

    return { singleCore, multiCore };
  } catch (error) {
    console.error(`❌ [Geekbench 에러] ${cpuName}:`, error.message);
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};

app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  if (!cpuName) return res.status(400).json({ error: "CPU 이름이 필요합니다." });
  const score = await fetchCpuBenchmark(cpuName);
  res.json({ cpu: cpuName, benchmarkScore: score });
});

// ✅ GPU 벤치마크 (미구현)
app.get("/api/gpu-benchmark", async (req, res) => {
  const gpuName = req.query.gpu;
  if (!gpuName) return res.status(400).json({ error: "GPU 이름이 필요합니다." });
  res.json({ gpu: gpuName, benchmarkScore: "지원 예정" });
});

// ✅ 상세 부품 정보
const dummyParts = {
  cpu: [
    {
      id: 1,
      name: "Intel Core i5-14600K",
      specs: { cores: 14, threads: 20, baseClock: "3.5GHz", boostClock: "5.3GHz", TDP: "125W" },
    },
    {
      id: 2,
      name: "Intel Core i9-14900K",
      specs: { cores: 24, threads: 32, baseClock: "3.2GHz", boostClock: "6.0GHz", TDP: "125W" },
    },
  ],
  gpu: [
    {
      id: 1,
      name: "NVIDIA RTX 4070",
      specs: { memory: "12GB", baseClock: "1920MHz", boostClock: "2475MHz", TDP: "200W" },
    },
  ],
};

app.get("/api/part-detail", (req, res) => {
  const { category, id } = req.query;
  const list = dummyParts[category] || [];
  const found = list.find((item) => item.id.toString() === id);
  if (!found) return res.status(404).json({ error: "부품을 찾을 수 없음" });
  res.json(found);
});

// ✅ 가격 히스토리 (더미)
app.get("/api/price-history", (req, res) => {
  const history = [
    { date: "2024-12", price: 560000 },
    { date: "2025-01", price: 570000 },
    { date: "2025-02", price: 545000 },
    { date: "2025-03", price: 552000 },
  ];
  res.json(history);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
