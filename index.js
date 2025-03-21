import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ✅ CORS 허용할 도메인 목록
const allowedOrigins = [
  "https://goodpricepc.vercel.app",
  "https://pc-site-frontend.vercel.app"
];

// ✅ CORS 설정
app.use(cors({
  origin: (origin, callback) => {
    // 로컬 요청 또는 origin이 없을 경우 허용
    if (!origin) return callback(null, true);
    
    // origin 도메인만 추출해서 비교
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

// ✅ GPT 한줄평 API
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
        max_tokens: 30,
        temperature: 0.7
      })
    });

    const data = await response.json();

    const review = data.choices?.[0]?.message?.content || "한줄평 생성 실패";

    console.log(`🧠 [GPT 한줄평] ${partName} ➜ ${review}`);
    res.json({ review });

  } catch (error) {
    console.error("❌ GPT API 요청 오류:", error);
    res.status(500).json({ error: "GPT API 요청 실패" });
  }
});

// ✅ 서버 실행
const PORT = 5000;
app.listen(PORT, () => console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`));
