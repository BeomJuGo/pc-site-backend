import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();

// ✅ CORS 허용할 도메인 목록
const allowedOrigins = [
  "https://goodpricepc.vercel.app",
];

// ✅ CORS 설정
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // 서버 자체 요청 허용
    const cleanOrigin = origin.split("/")[0] + "//" + origin.split("/")[2];
    if (allowedOrigins.includes(cleanOrigin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS 차단됨: ${origin}`);
      callback(new Error("CORS 차단: " + origin));
    }
  }
}));

app.use(express.json());

// ✅ 환경 변수
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 네이버 가격 API
app.get("/api/naver-price", async (req, res) => {
  const query = encodeURIComponent(req.query.query);
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${query}`;

  try {
    console.log(`🔍 [네이버 API 요청] ${query}`);
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });

    if (!response.ok) {
      throw new Error(`네이버 API 오류: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ [네이버 API 응답]`, data);

    res.json(data);
  } catch (error) {
    console.error("❌ 네이버 쇼핑 API 요청 오류:", error);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

// ✅ GPT 프록시 한줄평 API (sk-proj- 키 대응)
app.post("/api/gpt-review", async (req, res) => {
  const { partName } = req.body;

  const prompt = `${partName}의 특징을 간단히 요약한 한줄평을 만들어줘.`;

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
        max_tokens: 150,  // ✅ 30 → 150으로 증가 (더 긴 응답 받기)
        temperature: 0.7
      })
    });

    const data = await response.json();

    console.log("🧠 GPT 응답 전체:\n", JSON.stringify(data, null, 2));

    const review = data.choices?.[0]?.message?.content || "한줄평 생성 실패";
    console.log(`🧠 [GPT 한줄평] ${partName} ➜ ${review}`);

    res.json({ review });

  } catch (error) {
    console.error("❌ GPT API 요청 오류:", error);
    res.status(500).json({ error: "GPT API 요청 실패" });
  }
});

// ✅ CPU 벤치마크 점수 크롤링 함수
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const searchQuery = cpuName.replace(/\s+/g, "+");
    const url = `https://www.cpubenchmark.net/cpu.php?cpu=${searchQuery}`;
    console.log("🔍 [CPU 벤치마크 요청 URL]:", url);

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const $ = cheerio.load(data);
    const scoreText = $("span.count").first().text().trim();
    const benchmarkScore = scoreText.replace(/,/g, ""); // 쉼표 제거

    console.log(`✅ [CPU 벤치마크 점수] ${cpuName}: ${benchmarkScore}`);
    return benchmarkScore || "점수 없음";
  } catch (error) {
    console.error(`❌ [CPU 벤치마크 크롤링 실패] ${cpuName}:`, error.message);
    return "점수 없음";
  }
};




// ✅ GPU 벤치마크 점수 크롤링 함수
const fetchGpuBenchmark = async (gpuName) => {
  try {
    const searchQuery = encodeURIComponent(gpuName);
    const url = `https://www.videocardbenchmark.net/gpu.php?gpu=${searchQuery}`;

    console.log(`🔍 [GPU 벤치마크 데이터 요청] ${url}`);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // ✅ PassMark 벤치마크 점수 가져오기
    const scoreText = $("#mark").text().trim();
    const benchmarkScore = scoreText.replace(/\D/g, ""); // 숫자만 추출

    console.log(`✅ [GPU 벤치마크 점수] ${gpuName}: ${benchmarkScore}`);
    return benchmarkScore || "점수 없음";
  } catch (error) {
    console.error(`❌ [GPU 벤치마크 가져오기 실패] ${gpuName}:`, error);
    return "점수 없음";
  }
};

// ✅ 벤치마크 API 엔드포인트 추가
// ✅ 테스트용 벤치마크 API
app.get("/api/test-cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu || "Intel Core i7-13700k";
  const score = await fetchCpuBenchmark(cpuName);
  res.json({ cpu: cpuName, benchmarkScore: score });
});


app.get("/api/gpu-benchmark", async (req, res) => {
  const gpuName = req.query.gpu;
  if (!gpuName) return res.status(400).json({ error: "GPU 이름이 필요합니다." });

  const score = await fetchGpuBenchmark(gpuName);
  res.json({ gpu: gpuName, benchmarkScore: score });
});

// ✅ 서버 실행
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});

