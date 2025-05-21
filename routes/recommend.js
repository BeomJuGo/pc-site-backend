import express from "express";
import { getDB } from "../db.js";
import fetch from "node-fetch";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ✅ GPT로부터 목적에 따라 CPU 모델명만 추출
const getGPTRecommendedCPUs = async (purpose) => {
  const promptMap = {
    가성비: "2025년 기준으로 가성비 좋은 CPU 5개를 추천해줘. AMD와 Intel 포함. 모델명만 알려줘.",
    게이밍: "2025년 게이머들에게 인기 있는 CPU 5개를 추천해줘. AMD와 Intel 포함. 모델명만 알려줘.",
    전문가용: "영상 편집, 3D 모델링, CAD 등 전문가용 작업에 적합한 CPU 5개를 추천해줘. AMD와 Intel 포함. 모델명만 알려줘.",
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: "너는 PC 부품 추천 전문가야." },
          { role: "user", content: promptMap[purpose] },
        ],
      }),
    });

    const data = await res.json();
    const gptText = data.choices?.[0]?.message?.content || "";

    // ✅ 모델명 추출: "AMD" 또는 "Intel" 포함 + 숫자 있는 줄만
    return gptText
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter((line) =>
        /(?:AMD|Intel).*?\d{3,5}/i.test(line) // CPU 이름 추정 정규식
      );
  } catch (e) {
    console.error("❌ GPT 요청 실패:", e);
    return [];
  }
};

// ✅ 헬스 체크용 테스트 엔드포인트
router.get("/test", (req, res) => {
  res.send("✅ 추천 API 정상 연결됨");
});

// ✅ 추천 API
router.post("/", async (req, res) => {
  console.log("🔔 [추천 API 호출됨] POST /api/recommend");

  const { budget, purpose } = req.body;
  if (!budget || !purpose) {
    return res.status(400).json({ error: "budget과 purpose를 입력해주세요." });
  }

  const db = await getDB();
  const cpuCol = db.collection("cpus");

  try {
    const gptNames = await getGPTRecommendedCPUs(purpose);
    console.log("💬 [GPT 추천 CPU 목록]", gptNames);

    // ✅ GPT 결과가 비었으면 즉시 종료
    if (!gptNames || gptNames.length === 0) {
      return res
        .status(400)
        .json({ message: "GPT에서 유효한 CPU 모델명을 받지 못했습니다." });
    }

    // ✅ MongoDB 쿼리
    const matchedCPUs = await cpuCol
      .find({
        $or: gptNames.map((name) => ({
          name: { $regex: new RegExp(name, "i") },
        })),
      })
      .toArray();

    if (matchedCPUs.length === 0) {
      console.warn("⚠️ DB에서 일치하는 CPU 없음");
      return res
        .status(404)
        .json({ message: "DB에서 일치하는 CPU를 찾을 수 없습니다." });
    }

    const min = budget * 0.95;
    const max = budget * 1.05;

    const recommended = matchedCPUs
      .filter((cpu) => cpu.price >= min && cpu.price <= max)
      .slice(0, 3);

    console.log("✅ 추천 완료:", recommended.map((c) => c.name));

    return res.json({
      purpose,
      budget,
      gptCandidates: gptNames,
      recommendedCPUs: recommended,
    });
  } catch (err) {
    console.error("❌ 추천 실패:", err);
    res.status(500).json({ error: "GPT 추천 또는 DB 처리 중 오류 발생" });
  }
});

export default router;
