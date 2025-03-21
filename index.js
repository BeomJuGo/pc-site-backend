import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://goodpricepc.vercel.app",
];

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

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

    if (!response.ok) throw new Error(`네이버 API 오류: ${response.status}`);

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("❌ 네이버 쇼핑 API 오류:", error);
    res.status(500).json({ error: "네이버 API 요청 실패" });
  }
});

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
    console.error("❌ GPT API 오류:", error);
    res.status(500).json({ error: "GPT API 요청 실패" });
  }
});

// ✅ Geekbench CPU 벤치마크 목록에서 점수 크롤링
import axios from "axios";
import * as cheerio from "cheerio";

// Geekbench CPU 벤치마크 점수 크롤링 함수
const fetchCpuBenchmark = async (cpuName) => {
  try {
    const url = `https://browser.geekbench.com/processor-benchmarks`;
    console.log(`🔍 [Geekbench CPU 목록 페이지 요청] ${url}`);

    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    let found = false;
    let singleCore = "점수 없음";
    let multiCore = "점수 없음";

    $(".table tbody tr").each((_, element) => {
      const name = $(element).find("td.name").text().trim().toLowerCase();
      const single = $(element).find("td.score:nth-child(2)").text().trim();
      const multi = $(element).find("td.score:nth-child(3)").text().trim();

      if (name.includes(cpuName.toLowerCase())) {
        singleCore = single;
        multiCore = multi;
        found = true;
        return false; // 루프 중단
      }
    });

    if (!found) {
      throw new Error(`CPU 이름 (${cpuName})을 Geekbench 목록에서 찾을 수 없음.`);
    }

    console.log(`✅ [Geekbench 점수] ${cpuName} Single: ${singleCore}, Multi: ${multiCore}`);

    return { singleCore, multiCore };
  } catch (error) {
    console.error(`❌ [Geekbench CPU 벤치마크 가져오기 실패] ${cpuName}:`, error.message);
    return { singleCore: "점수 없음", multiCore: "점수 없음" };
  }
};


app.get("/api/cpu-benchmark", async (req, res) => {
  const cpuName = req.query.cpu;
  if (!cpuName) return res.status(400).json({ error: "CPU 이름이 필요합니다." });

  const benchmarkScore = await fetchCpuBenchmark(cpuName);
  res.json({ cpu: cpuName, benchmarkScore });
});

app.get("/api/gpu-benchmark", (_, res) => {
  res.json({ benchmarkScore: "지원 예정" });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
