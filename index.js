import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();
const app = express();

// ✅ 허용된 Origin
const allowedOrigins = [
  "https://goodpricepc.vercel.app",
  "http://localhost:3000"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS 차단됨: ${origin}`);
      callback(new Error("CORS 차단: " + origin));
    }
  },
  credentials: true,
}));

app.use(express.json());

// ✅ 환경변수
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 네이버 쇼핑 가격 및 이미지
app.get("/api/naver-price", async (req, res) => {
  const query = encodeURIComponent(req.query.query);
  const start = req.query.start || 1;
  const display = req.query.display || 10;
  const sort = req.query.sort || "asc";

  const url = `https://openapi.naver.com/v1/search/shop.json?query=${query}&start=${start}&display=${display}&sort=${sort}`;

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
    console.error("❌ 네이버 API 요청 실패:", error.message);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ✅ GPT 정보 통합 (한줄평 + 사양 요약)
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: reviewPrompt }],
          max_tokens: 150,
          temperature: 0.7
        }),
      }),
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: specPrompt }],
          max_tokens: 150,
          temperature: 0.7
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

// ✅ CPU 벤치마크
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

    if (scores.length === 0) {
      return res.status(404).json({ error: "해당 CPU 점수를 찾을 수 없습니다." });
    }

    const singleCore = Math.min(...scores).toString();
    const multiCore = Math.max(...scores).toString();

    res.json({ cpu: cpuName, benchmarkScore: { singleCore, multiCore } });
  } catch (error) {
    console.error("❌ 벤치마크 크롤링 실패:", error.message);
    res.status(500).json({ error: "벤치마크 크롤링 실패" });
  }
});

// ✅ 서버 시작
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
