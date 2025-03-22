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
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS 차단됨: ${origin}`);
      callback(new Error("CORS 차단: " + origin));
    }
  }
}));

app.use(express.json());

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 네이버 쇼핑 API
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
    console.error("❌ 네이버 API 오류:", error);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ✅ GPT 요약 (한줄평 / 사양요약 겸용)
app.post("/api/gpt-review", async (req, res) => {
  const { partName, type } = req.body;

  let prompt = "";
  if (type === "spec") {
    prompt = `${partName}의 주요 사양을 간략히 요약해줘.`;
  } else {
    prompt = `${partName}의 특징을 간단히 요약한 한줄평을 만들어줘.`;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "정보 생성 실패";
    res.json({ result: content });
  } catch (error) {
    console.error("❌ GPT API 오류:", error);
    res.status(500).json({ error: "GPT 요청 실패" });
  }
});

// ✅ Geekbench CPU 벤치마크
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
    return { singleCore: Math.min(...scores).toString(), multiCore: Math.max(...scores).toString() };
  } catch (error) {
    return { singleCore: "점수 없음", multiCore: "점수 없음", error: error.message };
  }
};

app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  const score = await fetchCpuBenchmark(cpuName);
  res.json({ cpu: cpuName, benchmarkScore: score });
});

// GPU 지원 예정
app.get("/api/gpu-benchmark", async (req, res) => {
  const gpuName = req.query.gpu;
  res.json({ gpu: gpuName, benchmarkScore: "지원 예정" });
});

// ✅ 상세 정보/가격 히스토리 (더미 데이터)
app.get("/api/part-detail", async (req, res) => {
  const { category, id } = req.query;
  res.json({
    id,
    name: category === "cpu" ? "Intel Core i9-14900K" : "NVIDIA RTX 4070",
    price: "699000",
    image: "https://example.com/image.jpg",
    benchmarkScore: {
      singleCore: "3055",
      multiCore: "20500"
    },
    review: "최신 고성능 CPU로 멀티태스킹과 게임 성능 모두 뛰어납니다.",
    specSummary: "24코어, 32스레드, 6GHz 최대 클럭, 125W TDP"
  });
});

app.get("/api/price-history", async (req, res) => {
  res.json([
    { date: "2024-03-01", price: 710000 },
    { date: "2024-03-08", price: 695000 },
    { date: "2024-03-15", price: 699000 },
  ]);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 실행: http://localhost:${PORT}`);
});
