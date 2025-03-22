import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();
const app = express();

// ✅ CORS 허용 도메인
const allowedOrigins = ["https://goodpricepc.vercel.app"];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS 차단됨: ${origin}`);
      callback(new Error("CORS 차단됨: " + origin));
    }
  },
}));

app.use(express.json());

// ✅ 환경 변수
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

//
// ✅ 네이버 쇼핑 가격 검색
//
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
    console.error("❌ 네이버 API 오류:", error.message);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

//
// ✅ GPT 프록시 요청 (한줄평)
//
app.post("/api/gpt-review", async (req, res) => {
  const { partName } = req.body;
  const prompt = `${partName}의 특징을 간단히 요약한 한줄평을 만들어줘.`;

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
    const review = data.choices?.[0]?.message?.content || "한줄평 생성 실패";
    res.json({ review });
  } catch (error) {
    console.error("❌ GPT 요청 오류:", error.message);
    res.status(500).json({ error: "GPT 요청 실패" });
  }
});

//
// ✅ Geekbench CPU 벤치마크 크롤링
//
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = "https://browser.geekbench.com/processor-benchmarks";
    console.log(`🔍 [Geekbench 페이지 요청] ${url}`);

    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const rows = $("table tbody tr");
    const matched = [];

    rows.each((_, row) => {
      const name = $(row).find("td").eq(0).text().trim();
      const scoreText = $(row).find("td").eq(1).text().trim().replace(/,/g, "");
      const score = parseInt(scoreText, 10);

      if (name.toLowerCase().includes(cpuName.toLowerCase())) {
        matched.push({ name, score });
      }
    });

    if (matched.length === 0) {
      throw new Error("❌ 해당 CPU 이름을 포함하는 항목을 찾을 수 없습니다.");
    }

    matched.sort((a, b) => a.score - b.score);

    const singleCore = matched[0]?.score || "점수 없음";
    const multiCore = matched[matched.length - 1]?.score || "점수 없음";

    console.log(`✅ [Geekbench 점수] ${cpuName} ➜ Single: ${singleCore}, Multi: ${multiCore}`);
    return { singleCore, multiCore };
  } catch (error) {
    console.error(`❌ [CPU 벤치마크 에러] ${cpuName}:`, error.message);
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};

//
// ✅ CPU 벤치마크 API 엔드포인트
//
app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  if (!cpuName) return res.status(400).json({ error: "CPU 이름이 필요합니다." });

  const benchmarkScore = await fetchCpuBenchmark(cpuName);
  res.json({ cpu: cpuName, benchmarkScore });
});

//
// ✅ GPU 벤치마크 (추후 확장)
//
app.get("/api/gpu-benchmark", async (req, res) => {
  const gpuName = req.query.gpu;
  if (!gpuName) return res.status(400).json({ error: "GPU 이름이 필요합니다." });

  res.json({ gpu: gpuName, benchmarkScore: "지원 예정" });
});

//
// ✅ 부품 상세 + 가격 변동 API (DB 미연동 상태)
//
app.get("/api/part-detail", async (req, res) => {
  const { category, id } = req.query;
  res.json({ error: "DB 연동 시 구현 예정" });
});

app.get("/api/price-history", async (req, res) => {
  const { category, id } = req.query;
  res.json([]); // 더미 데이터
});

//
// ✅ 서버 시작
//
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
