// ✅ 백엔드 index.js (GPT로 한줄평 & 사양 요약 포함)
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
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ✅ GPT 한줄평
app.post("/api/gpt-review", async (req, res) => {
  const { partName } = req.body;
  const prompt = `${partName}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const review = data.choices?.[0]?.message?.content || "한줄평 생성 실패";
    res.json({ review });
  } catch (error) {
    res.status(500).json({ error: "GPT 요청 실패" });
  }
});

// ✅ GPT 사양 요약
app.post("/api/gpt-spec-summary", async (req, res) => {
  const { partName } = req.body;
  const prompt = `${partName}의 주요 사양을 요약해서 알려줘. 코어 수, 스레드 수, L2/L3 캐시, 베이스 클럭, 부스트 클럭 위주로 간단하게 정리해줘. 예시: 코어: 6, 스레드: 12, ...`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const specSummary = data.choices?.[0]?.message?.content || "사양 요약 실패";
    res.json({ specSummary });
  } catch (error) {
    res.status(500).json({ error: "GPT 사양 요약 실패" });
  }
});

// ✅ CPU 벤치마크 (정적 HTML)
app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  if (!cpuName) return res.status(400).json({ error: "CPU 이름이 필요합니다." });

  try {
    const url = "https://browser.geekbench.com/processor-benchmarks";
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    const scores = [];
    $("table tbody tr").each((_, row) => {
      const name = $(row).find("td").eq(0).text().trim();
      const score = parseInt($(row).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
      if (name.toLowerCase().includes(cpuName.toLowerCase()) && !isNaN(score)) {
        scores.push(score);
      }
    });

    const singleCore = Math.min(...scores).toString();
    const multiCore = Math.max(...scores).toString();

    res.json({ cpu: cpuName, benchmarkScore: { singleCore, multiCore } });
  } catch (error) {
    res.status(500).json({ error: "벤치마크 크롤링 실패" });
  }
});

// ✅ 서버 실행
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
