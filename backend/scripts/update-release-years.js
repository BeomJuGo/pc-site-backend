/**
 * 모든 부품의 출시 연도를 GPT API로 조회해 DB에 releaseYear 필드로 저장.
 * 이미 releaseYear가 있는 부품은 건너뜀 (--force 옵션으로 전체 재실행 가능).
 *
 * 실행: node backend/scripts/update-release-years.js
 *        node backend/scripts/update-release-years.js --force
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BATCH_SIZE = 25;
const DELAY_MS = 400; // API rate limit 방어
const FORCE = process.argv.includes("--force");

async function getReleaseYearsBatch(parts) {
  const lines = parts.map((p, i) => `${i + 1}. [${p.category}] ${p.name}`).join("\n");
  const prompt = `다음 PC 부품들의 최초 출시 연도를 숫자 배열(JSON)로 답하세요.
모르는 경우 null로 표시. 연도는 4자리 숫자만. 설명 없이 JSON 배열만 출력하세요.

예시 응답: [2023, 2021, null, 2024, 2022]

부품 목록:
${lines}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const resp = await res.json();

  const text = resp.choices?.[0]?.message?.content?.trim() ?? ""
    .replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr) || arr.length !== parts.length) {
      console.warn(`  ⚠️  응답 배열 길이 불일치 (기대: ${parts.length}, 실제: ${arr?.length})`);
      return parts.map(() => null);
    }
    return arr.map((y) => (Number.isInteger(y) && y >= 2000 && y <= 2030 ? y : null));
  } catch {
    console.warn(`  ⚠️  JSON 파싱 실패: ${text.slice(0, 80)}`);
    return parts.map(() => null);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db("pcsite");
  const col = db.collection("parts");

  const query = FORCE ? {} : { releaseYear: { $exists: false } };
  const parts = await col.find(query, { projection: { _id: 1, name: 1, category: 1 } }).toArray();

  if (parts.length === 0) {
    console.log("✅ 업데이트할 부품 없음 (모두 releaseYear 존재). --force로 재실행 가능.");
    await client.close();
    return;
  }

  console.log(`🔄 총 ${parts.length}개 부품 처리 시작 (배치 크기: ${BATCH_SIZE})`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < parts.length; i += BATCH_SIZE) {
    const batch = parts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(parts.length / BATCH_SIZE);
    process.stdout.write(`  배치 ${batchNum}/${totalBatches} (${batch.length}개)... `);

    try {
      const years = await getReleaseYearsBatch(batch);

      const ops = batch.map((p, j) => ({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { releaseYear: years[j] ?? null } },
        },
      }));

      await col.bulkWrite(ops, { ordered: false });

      const setCount = years.filter((y) => y !== null).length;
      const nullCount = years.filter((y) => y === null).length;
      console.log(`✓ (연도 확인: ${setCount}개, 미확인: ${nullCount}개)`);
      updated += setCount;
      failed += nullCount;
    } catch (err) {
      console.log(`✗ 오류: ${err.message}`);
      failed += batch.length;
    }

    if (i + BATCH_SIZE < parts.length) await sleep(DELAY_MS);
  }

  console.log(`\n✅ 완료: 연도 저장 ${updated}개 / 미확인(null) ${failed}개`);
  await client.close();
}

main().catch((err) => {
  console.error("스크립트 실패:", err);
  process.exit(1);
});
