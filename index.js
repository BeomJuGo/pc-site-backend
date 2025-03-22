import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
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
  const query = req.query.query;
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET
      }
    });

    if (!response.ok) throw new Error("네이버 API 오류");

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ✅ GPT 요약 API
app.post("/api/gpt-review", async (req, res) => {
  const { partName, specs } = req.body;
  const prompt = `${partName}의 주요 사양은 다음과 같아: ${specs}. 이 제품에 대한 한줄평을 작성해줘.`;

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
        max_tokens: 150
      })
    });

    const data = await response.json();
    const review = data.choices?.[0]?.message?.content || "한줄평 없음";
    res.json({ review });
  } catch (error) {
    res.status(500).json({ error: "GPT 요약 실패" });
  }
});

// ✅ Geekbench CPU 벤치마크
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = "https://browser.geekbench.com/processor-benchmarks";
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const matched = [];

    $("table tbody tr").each((_, row) => {
      const name = $(row).find("td").eq(0).text().trim();
      const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
      if (name.toLowerCase().includes(cpuName.toLowerCase())) {
        matched.push(score);
      }
    });

    if (matched.length === 0) throw new Error("점수 없음");

    const singleCore = Math.min(...matched).toString();
    const multiCore = Math.max(...matched).toString();
    return { singleCore, multiCore };
  } catch {
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};

app.get("/api/cpu-benchmark", async (req, res) => {
  const cpu = req.query.cpu;
  const score = await fetchCpuBenchmark(cpu);
  res.json({ benchmarkScore: score });
});

app.get("/api/gpu-benchmark", async (req, res) => {
  res.json({ benchmarkScore: "지원 예정" });
});

// ✅ 서버 실행
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
