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
      callback(new Error("CORS 차단: " + origin));
    }
  },
}));
app.use(express.json());

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 네이버 가격 조회
app.get("/api/naver-price", async (req, res) => {
  try {
    const query = encodeURIComponent(req.query.query);
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${query}`;
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

// ✅ GPT 한줄평 + 사양 요약
app.post("/api/gpt-review", async (req, res) => {
  const { partName } = req.body;
  const prompt = `
"${partName}" 부품에 대해 다음 두 가지 정보를 요약해줘:
1. AI 한줄평 (장단점 요약)
2. 주요 사양 (코어, 클럭, 전력 등 요약)

아래 형식으로:
한줄평: ...
사양요약: ...
  `.trim();

  try {
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    const data = await gptRes.json();
    const content = data.choices?.[0]?.message?.content || "";

    const reviewMatch = content.match(/한줄평[:\-]?\s*(.+)/i);
    const specMatch = content.match(/사양요약[:\-]?\s*(.+)/i);

    const review = reviewMatch?.[1]?.trim() || "한줄평 없음";
    const specSummary = specMatch?.[1]?.trim() || "사양 정보 없음";

    res.json({ review, specSummary });
  } catch (error) {
    res.status(500).json({ review: "한줄평 오류", specSummary: "사양 오류" });
  }
});

// ✅ Geekbench CPU 점수
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = "https://browser.geekbench.com/processor-benchmarks";
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);
    const scores = [];

    $("table tbody tr").each((_, el) => {
      const name = $(el).find("td").eq(0).text().trim();
      const score = parseInt($(el).find("td").eq(1).text().trim().replace(/,/g, ""), 10);
      if (name.toLowerCase().includes(cpuName.toLowerCase())) {
        scores.push(score);
      }
    });

    return {
      singleCore: Math.min(...scores).toString(),
      multiCore: Math.max(...scores).toString(),
    };
  } catch {
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};

app.get("/api/cpu-benchmark", async (req, res) => {
  const cpu = req.query.cpu;
  if (!cpu) return res.status(400).json({ error: "CPU 이름 필요" });

  const score = await fetchCpuBenchmark(cpu);
  res.json({ cpu, benchmarkScore: score });
});

// ✅ GPU (미지원)
app.get("/api/gpu-benchmark", async (req, res) => {
  res.json({ benchmarkScore: "지원 예정" });
});

// ✅ 서버 실행
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
