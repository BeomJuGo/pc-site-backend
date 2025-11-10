import express from "express";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateReviewAndSpec(name, specHint = "") {
  if (!OPENAI_API_KEY) {
    return { review: "", specSummary: "" };
  }
  const prompt = `부품 \"${name}\"(힌트: ${specHint})의 한줄평과 스펙요약을 JSON으로 작성: {"review":"<100자 이내>", "specSummary":"<핵심 스펙 요약>"}`;
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          temperature: 0.4,
          messages: [
            { role: "system", content: "너는 PC 부품 전문가야. JSON만 출력해." },
            { role: "user", content: prompt },
          ],
        }),
      });
      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}") + 1;
      const parsed = JSON.parse(raw.slice(start, end));
      return {
        review: parsed.review?.trim() || "",
        specSummary: parsed.specSummary?.trim() || "",
      };
    } catch (e) {
      await sleep(800 * Math.pow(2, i));
    }
  }
  return { review: "", specSummary: "" };
}

router.post("/backfill-ai", async (req, res) => {
  const { category = null, limit = 2000, force = false } = req.body || {};
  try {
    const db = getDB();
    const col = db.collection("parts");

    // force가 true면 모든 항목, false면 review나 specSummary가 없는 항목만
    const query = {
      ...(category ? { category } : {}),
      ...(force ? {} : {
        $or: [
          { review: { $exists: false } },
          { review: "" },
          { specSummary: { $exists: false } },
          { specSummary: "" },
        ],
      }),
    };

    const targets = await col
      .find(query)
      .project({ name: 1, category: 1, info: 1, specSummary: 1, review: 1 })
      .limit(parseInt(limit))
      .toArray();

    res.json({ message: `백필 시작: ${targets.length}건`, category, limit });

    setImmediate(async () => {
      let success = 0;
      let skipped = 0;
      console.log(`\n🤖 AI 백필 시작: ${targets.length}개 항목 처리 예정`);
      console.log(`📋 카테고리: ${category || '전체'}, 제한: ${limit}개, 강제 재생성: ${force ? '예' : '아니오'}\n`);

      for (const t of targets) {
        const needReview = force || !t.review;
        const needSpec = force || !t.specSummary;

        if (!needReview && !needSpec) {
          skipped++;
          console.log(`⏭️  건너뜀: ${t.name} (이미 review와 specSummary가 있음)`);
          continue;
        }

        const updateType = [];
        if (needReview) updateType.push('review');
        if (needSpec) updateType.push('specSummary');

        console.log(`🤖 AI 생성 중: [${t.category}] ${t.name.slice(0, 50)}${t.name.length > 50 ? '...' : ''} (${updateType.join(', ')})`);

        const ai = await generateReviewAndSpec(t.name, t.info || "");
        const update = {};
        if (needReview && ai.review) update.review = ai.review;
        if (needSpec && ai.specSummary) update.specSummary = ai.specSummary;

        if (Object.keys(update).length > 0) {
          await col.updateOne({ _id: t._id }, { $set: update });
          success++;
          const updatedFields = Object.keys(update).join(', ');
          if (ai.review) {
            console.log(`   ✅ 성공: "${ai.review.slice(0, 60)}${ai.review.length > 60 ? '...' : ''}"`);
          }
          if (ai.specSummary) {
            console.log(`   📝 스펙요약: "${ai.specSummary.slice(0, 60)}${ai.specSummary.length > 60 ? '...' : ''}"`);
          }
          console.log(`   📌 업데이트된 필드: ${updatedFields}\n`);
        } else {
          console.log(`   ⚠️  AI 생성 실패 또는 빈 값 반환\n`);
        }

        await sleep(200);
      }

      console.log(`\n📊 백필 완료 통계:`);
      console.log(`   ✅ 성공: ${success}개`);
      console.log(`   ⏭️  건너뜀: ${skipped}개`);
      console.log(`   📦 전체: ${targets.length}개`);
      console.log(`✅ 백필 완료: ${success}/${targets.length}\n`);
    });
  } catch (err) {
    console.error("❌ backfill-ai 실패", err);
    res.status(500).json({ error: "backfill-ai 실패" });
  }
});

export default router;
