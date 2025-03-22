import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { exec } from "child_process";
import axios from "axios";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ 가격 + 이미지 정보: danawa-py 호출
app.get("/api/part-info", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "쿼리가 필요합니다." });

  exec(`python3 danawa.py "${query}"`, (error, stdout, stderr) => {
    if (error) {
      console.error("❌ danawa.py 실행 실패:", stderr);
      return res.status(500).json({ error: "가격 정보 가져오기 실패" });
    }

    try {
      const parsed = JSON.parse(stdout);
      res.json(parsed);
    } catch (e) {
      console.error("❌ JSON 파싱 실패:", e);
      res.status(500).json({ error: "결과 파싱 실패" });
    }
  });
});

// ✅ GPT 한줄평 + 사양 요약
app.post("/api/gpt-info", async (req, res) => {
  const { partName } = req.body;
  const reviewPrompt = `${partName}의 장점과 단점을 각각 한 문장으로 알려줘. 형식은 '장점: ..., 단점: ...'으로 해줘.`;
  const specPrompt = `${partName}의 주요 사양을 요약해서 알려줘. 코어 수, 스레드 수, L2/L3 캐시, 베이스/부스트 클럭 중심으로 간단히.`;

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
        })
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
        })
      }),
    ]);

    const reviewData = await reviewRes.json();
    const specData = await specRes.json();

    res.json({
      review: reviewData.choices?.[0]?.message?.content || "한줄평 없음",
      specSummary: specData.choices?.[0]?.message?.content || "사양 요약 없음"
    });
  } catch (error) {
    console.error("❌ GPT 요청 실패:", error);
    res.status(500).json({ error: "GPT 요청 실패" });
  }
});

// ✅ Geekbench 점수 크롤링
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

    res.json({ benchmarkScore: { singleCore, multiCore } });
  } catch (error) {
    res.status(500).json({ error: "벤치마크 크롤링 실패" });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
