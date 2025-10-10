// routes/syncMOTHERBOARD.js - 다나와 메인보드 크롤링 (Puppeteer 버전)
import express from "express";
import puppeteer from "puppeteer";
import fetch from "node-fetch";
import { getDB } from "../db.js";

const router = express.Router();

const DANAWA_BASE_URL = "https://prod.danawa.com/list/?cate=112751";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==================== OpenAI 한줄평 생성 ==================== */
async function fetchAiOneLiner({ name, spec }) {
  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY 미설정: AI 한줄평 생략");
    return { review: "", specSummary: "" };
  }

  const prompt = `
당신은 PC 부품 전문가입니다. 다나와에서 크롤링한 메인보드 정보를 바탕으로 한국어로 간결한 한줄평과 핵심 스펙 요약을 작성해주세요.

[제품명]
${name}

[스펙 정보]
${spec || "-"}

[요구사항]
- 한줄평(review): 1문장, 100자 이내, 초보자도 이해하기 쉬운 표현
- 스펙 요약(specSummary): 1문장, 100자 이내, 소켓/칩셋/폼팩터 포함
- JSON만 출력

형식:
{
  "review": "<한줄평>",
  "specSummary": "<요약>"
}
  `.trim();

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4",
          temperature: 0.4,
          messages: [
            { role: "system", content: "너는 PC 부품 요약 전문가야." },
            { role: "user", content: prompt },
          ],
        }),
      });

      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}") + 1;
      const jsonStr = raw.slice(start, end);
      const parsed = JSON.parse(jsonStr);

      return {
        review: parsed.review?.trim() || "",
        specSummary: parsed.specSummary?.trim() || "",
      };
    } catch (e) {
      const wait = 800 * Math.pow(2, i);
      console.log(`⚠️ AI 한줄평 실패(${i + 1}): ${e.message} → ${wait}ms 대기`);
      await sleep(wait);
    }
  }
  return { review: "", specSummary: "" };
}

/* ==================== 소켓 정보 추출 ==================== */
function extractSocketInfo(spec = "") {
  // AM5
  if (/AM5|소켓AM5/i.test(spec)) return "Socket: AM5";
  if (/B650|X670|A620/i.test(spec)) return "Socket: AM5";

  // AM4
  if (/AM4|소켓AM4/i.test(spec)) return "Socket: AM4";
  if (/B550|X570|A520|B450|X470/i.test(spec)) return "Socket: AM4";

  // LGA1700
  if (/LGA\s?1700|소켓1700/i.test(spec)) return "Socket: LGA1700";
  if (/Z790|B760|H770|Z690|B660|H610/i.test(spec)) return "Socket: LGA1700";

  // LGA1200
  if (/LGA\s?1200|소켓1200/i.test(spec)) return "Socket: LGA1200";
  if (/Z590|B560|H570|H510|Z490|B460|H470|H410/i.test(spec))
    return "Socket: LGA1200";

  return "";
}

/* ==================== Puppeteer 다나와 크롤링 ==================== */
async function crawlDanawaMotherboards(maxPages = 30) {
  console.log(`🔍 다나와 메인보드 크롤링 시작 (최대 ${maxPages}페이지)`);

  let browser;
  const products = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`📄 페이지 ${pageNum}/${maxPages} 처리 중...`);

      try {
        // 첫 페이지는 기본 URL, 이후는 JavaScript 함수로 페이지 이동
        if (pageNum === 1) {
          await page.goto(DANAWA_BASE_URL, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
        } else {
          // movePage() JavaScript 함수 실행
          await page.evaluate((p) => {
            if (typeof movePage === "function") {
              movePage(p);
            }
          }, pageNum);

          // 페이지 로딩 대기
          await sleep(3000);
        }

        // 제품 리스트 추출
        const pageProducts = await page.evaluate(() => {
          const items = document.querySelectorAll(
            ".main_prodlist .product_list .prod_item"
          );
          const results = [];

          items.forEach((item) => {
            try {
              // 제품명
              const nameEl = item.querySelector(".prod_name a");
              const name = nameEl?.textContent?.trim();

              if (!name) return;

              // 가격
              const priceEl = item.querySelector(".price_sect strong");
              const priceText = priceEl?.textContent?.trim() || "0";
              const price = parseInt(priceText.replace(/[^\d]/g, ""), 10) || 0;

              // 이미지
              const imgEl = item.querySelector("img");
              const image = imgEl?.src || "";

              // 스펙 정보
              const specEl = item.querySelector(".spec_list");
              const spec = specEl?.textContent
                ?.trim()
                .replace(/\s+/g, " ")
                .replace(/더보기/g, "");

              results.push({
                name,
                price,
                image,
                spec: spec || "",
              });
            } catch (e) {
              console.log("⚠️ 아이템 파싱 실패:", e.message);
            }
          });

          return results;
        });

        console.log(`✅ 페이지 ${pageNum}: ${pageProducts.length}개 수집`);
        products.push(...pageProducts);

        // 다음 페이지가 있는지 확인
        const hasNext = await page.evaluate(() => {
          const nextBtn = document.querySelector(".nav_next");
          return nextBtn && !nextBtn.classList.contains("disabled");
        });

        if (!hasNext && pageNum < maxPages) {
          console.log(`⏹️ 마지막 페이지 도달 (페이지 ${pageNum})`);
          break;
        }

        await sleep(1000); // 서버 부하 방지
      } catch (e) {
        console.error(`❌ 페이지 ${pageNum} 처리 실패:`, e.message);
        break;
      }
    }
  } catch (error) {
    console.error("❌ 크롤링 실패:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`🎉 총 ${products.length}개 제품 수집 완료`);
  return products;
}

/* ==================== MongoDB 저장 ==================== */
async function saveToMongoDB(motherboards, { ai = true, force = false } = {}) {
  const db = getDB();
  const col = db.collection("parts");
  const existing = await col.find({ category: "motherboard" }).toArray();
  const byName = new Map(existing.map((x) => [x.name, x]));

  console.log(`📊 저장 대상: ${motherboards.length}개`);

  let inserted = 0;
  let updated = 0;

  for (const board of motherboards) {
    const old = byName.get(board.name);

    // 소켓 정보 추출
    const info = extractSocketInfo(board.spec);

    let review = "";
    let specSummary = "";

    if (ai) {
      if (!old?.review || force) {
        const aiRes = await fetchAiOneLiner({
          name: board.name,
          spec: board.spec,
        });
        review = aiRes.review || old?.review || "";
        specSummary = aiRes.specSummary || old?.specSummary || "";
      } else {
        review = old.review;
        specSummary = old.specSummary || "";
      }
    }

    const update = {
      category: "motherboard",
      info,
      price: board.price,
      image: board.image,
      ...(ai ? { review, specSummary } : {}),
    };

    const today = new Date().toISOString().slice(0, 10);

    if (old) {
      // 기존 문서 업데이트
      const ops = { $set: update };

      // 가격 히스토리 추가 (오늘 날짜가 없으면)
      const hasToday = old.priceHistory?.some((p) => p.date === today);
      if (board.price > 0 && !hasToday) {
        ops.$push = {
          priceHistory: { date: today, price: board.price },
        };
      }

      await col.updateOne({ _id: old._id }, ops);
      updated++;
      console.log(`🔁 업데이트: ${board.name} (${board.price.toLocaleString()}원)`);
    } else {
      // 새 문서 삽입
      await col.insertOne({
        name: board.name,
        ...update,
        priceHistory: board.price > 0 ? [{ date: today, price: board.price }] : [],
      });
      inserted++;
      console.log(`🆕 삽입: ${board.name} (${board.price.toLocaleString()}원)`);
    }

    if (ai) await sleep(200); // OpenAI 레이트 리밋 방지
  }

  // 기존 목록에 없는 항목 삭제
  const currentNames = new Set(motherboards.map((b) => b.name));
  const toDelete = existing
    .filter((e) => !currentNames.has(e.name))
    .map((e) => e.name);

  if (toDelete.length > 0) {
    await col.deleteMany({ category: "motherboard", name: { $in: toDelete } });
    console.log(`🗑️ 삭제됨: ${toDelete.length}개`);
  }

  console.log(
    `\n📈 최종 결과: 삽입 ${inserted}개, 업데이트 ${updated}개, 삭제 ${toDelete.length}개`
  );
}

/* ==================== 라우터 ==================== */
router.post("/sync-motherboards", async (req, res) => {
  try {
    const maxPages = Number(req?.body?.pages) || 5;
    const ai = req?.body?.ai !== false;
    const force = !!req?.body?.force;

    res.json({
      message: `✅ 다나와 메인보드 동기화 시작 (pages=${maxPages}, ai=${ai}, force=${force})`,
    });

    setImmediate(async () => {
      try {
        const motherboards = await crawlDanawaMotherboards(maxPages);

        if (motherboards.length === 0) {
          console.log("⛔ 크롤링된 데이터 없음");
          return;
        }

        await saveToMongoDB(motherboards, { ai, force });
        console.log("🎉 메인보드 동기화 완료");
      } catch (err) {
        console.error("❌ 동기화 실패:", err);
      }
    });
  } catch (err) {
    console.error("❌ sync-motherboards 실패", err);
    res.status(500).json({ error: "sync-motherboards 실패" });
  }
});

export default router;
