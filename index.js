import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();

// ✅ CORS 허용할 도메인 목록
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

// ✅ GPT 프록시 한줄평 API
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
        max_tokens: 150,
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

// ✅ Geekbench 기반 CPU 벤치마크 크롤링 함수
const fetchCpuBenchmarkGeekbench = async (cpuName) => {
  try {
    const searchQuery = encodeURIComponent(cpuName);
    const searchUrl = `https://browser.geekbench.com/search?q=${searchQuery}`;

    console.log(`🔍 [Geekbench 검색 요청] ${searchUrl}`);
    
    // 1️⃣ Geekbench 검색 결과 페이지 가져오기
    const { data: searchPage } = await axios.get(searchUrl);
    const $search = cheerio.load(searchPage);

    // 2️⃣ 첫 번째 검색 결과의 개별 CPU 벤치마크 페이지 링크 추출
    const firstResult = $search("a.result-link").attr("href");
    if (!firstResult) throw new Error("Geekbench 개별 CPU 페이지를 찾을 수 없음");

    const cpuPageUrl = `https://browser.geekbench.com${firstResult}`;
    console.log(`🔍 [Geekbench 개별 CPU 페이지 요청] ${cpuPageUrl}`);

    // 3️⃣ 개별 CPU 페이지 가져오기
    const { data: cpuPage } = await axios.get(cpuPageUrl);
    const $cpu = cheerio.load(cpuPage);

    // 4️⃣ Geekbench 벤치마크 점수 추출
    const multiCoreScore = $cpu(".score.multicore").text().trim();
    const singleCoreScore = $cpu(".score.singlecore").text().trim();

    if (!multiCoreScore || !singleCoreScore) {
      throw new Error("Geekbench 점수를 찾을 수 없음");
    }

    console.log(`✅ [Geekbench 점수] ${cpuName} - 멀티코어: ${multiCoreScore}, 싱글코어: ${singleCoreScore}`);

    return {
      singleCore: singleCoreScore,
      multiCore: multiCoreScore
    };

  } catch (error) {
    console.error(`❌ [Geekbench CPU 벤치마크 가져오기 실패] ${cpuName}:`, error);
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};


// ✅ 벤치마크 API 엔드포인트 추가 (Geekbench)
app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  if (!cpuName) return res.status(400).json({ error: "CPU 이름이 필요합니다." });

  const score = await fetchCpuBenchmarkGeekbench(cpuName);
  res.json({ cpu: cpuName, benchmarkScore: score });
});

// ✅ 서버 실행
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
