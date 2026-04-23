// scripts/bulk-update-specs.mjs
// 불량 specSummary/review를 삭제하고 GPT-5.4로 전체 재생성
// 사용법: node scripts/bulk-update-specs.mjs [category] [--overwrite]
//   category: cpu|gpu|memory|motherboard|psu|cooler|case|storage (생략 시 전체)
//   --overwrite: 기존 데이터도 덮어씀 (생략 시 불량/미존재 항목만 처리)

import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "fs";

// .env 파일 파싱 (dotenv 없이)
if (existsSync(".env")) {
  const lines = readFileSync(".env", "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} else if (existsSync("backend/.env")) {
  const lines = readFileSync("backend/.env", "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GPT_MODEL = "gpt-5.4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 인수 파싱
const args = process.argv.slice(2);
const overwrite = args.includes("--overwrite");
const categoryArg = args.find((a) => !a.startsWith("--")) || null;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI 환경변수가 없습니다.");
  console.error("   MONGODB_URI=mongodb+srv://... node scripts/bulk-update-specs.mjs");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY 환경변수가 없습니다.");
  process.exit(1);
}

// 유효한 specSummary 판별 (adminMaintenance.js와 동일 기준)
const isValidSpec = (s) =>
  typeof s === "string" &&
  (s.match(/\//g) || []).length >= 2 &&
  (/:\s/.test(s) || /^(AMD|NVIDIA|Intel|인텔|DDR[345]|NVMe|SATA|소켓|정격)/i.test(s));

// 카테고리별 스펙 형식 프롬프트
const SPEC_FORMAT = {
  cpu: `"{name}" CPU의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: {브랜드}(소켓{소켓명})/{영어코어이름}({코어수}) 코어 {스레드수}스레드/지원 메모리: {DDR규격}/내장그래픽: {모델명 또는 미탑재}/기본 클럭: {base}GHz/최대 클럭: {boost}GHz/TDP: {tdp}W
예시: AMD(소켓AM4)/옥타(8) 코어 16스레드/지원 메모리: DDR4/내장그래픽: 미탑재/기본 클럭: 3.0GHz/최대 클럭: 3.7GHz/TDP: 65W
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  gpu: `"{name}" GPU의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: {NVIDIA 또는 AMD}({VRAM}GB {VRAM타입})/쉐이더: {숫자}개/부스트 클럭: {MHz}MHz/TDP: {W}W/인터페이스: PCIe {버전}/출력: {포트목록}
예시: NVIDIA(24GB GDDR6X)/쉐이더: 16384개/부스트 클럭: 2520MHz/TDP: 450W/인터페이스: PCIe 4.0/출력: HDMI 2.1×1, DP 1.4a×3
모르는 값은 반드시 ?로 표기하고, 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  memory: `"{name}" 메모리의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: {DDR규격}/{총용량}GB({구성, 예: 2×16GB})/동작 속도: {MHz}MHz/레이턴시: CL{cl}/전압: {V}V/{XMP 또는 EXPO 지원 여부}
예시: DDR5/32GB(2×16GB)/동작 속도: 6000MHz/레이턴시: CL36/전압: 1.35V/EXPO 지원
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  storage: `"{name}" 저장장치의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: {인터페이스(NVMe PCIe X.0 또는 SATA)}/{용량}/순차읽기: {read}MB/s/순차쓰기: {write}MB/s/폼팩터: {M.2 2280 또는 2.5인치}/캐시: {있음 또는 없음}
예시: NVMe PCIe 4.0/1TB/순차읽기: 7450MB/s/순차쓰기: 6900MB/s/폼팩터: M.2 2280/캐시: 있음
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  motherboard: `"{name}" 메인보드의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: 소켓: {소켓명}/칩셋: {칩셋}/지원 메모리: {DDR규격} {슬롯수}슬롯(최대 {최대용량}GB)/폼팩터: {ATX·mATX·ITX 등}/M.2 슬롯: {개수}개/PCIe {버전}
예시: 소켓: AM5/칩셋: B650/지원 메모리: DDR5 4슬롯(최대 128GB)/폼팩터: ATX/M.2 슬롯: 3개/PCIe 5.0
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  psu: `"{name}" 파워서플라이의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: 정격 출력: {W}W/효율: 80PLUS {등급}/모듈러: {풀 모듈러·세미 모듈러·논모듈러}/팬: {크기}mm/규격: {ATX·SFX 등}
예시: 정격 출력: 850W/효율: 80PLUS Gold/모듈러: 풀 모듈러/팬: 135mm/규격: ATX
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  cooler: `"{name}" CPU 쿨러의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: {공냉 또는 수냉(라디에이터 크기mm)}/팬: {크기}mm×{개수}개/지원 소켓: {소켓 목록}/TDP 지원: {W}W/{높이 또는 라디에이터 두께}
예시: 공냉/팬: 120mm×2개/지원 소켓: AM4·AM5·LGA1700·LGA1200/TDP 지원: 250W/높이: 158mm
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  case: `"{name}" PC 케이스의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.
형식: 폼팩터: {Full·Mid·Mini 타워 등}/지원 보드: {ATX·mATX·ITX 나열}/드라이브 베이: {3.5"×n, 2.5"×n}/팬 슬롯: {120mm×n, 140mm×n 등}/최대 라디에이터: {크기}mm/{전면 패널 포트 나열}
예시: 폼팩터: 미드 타워/지원 보드: ATX·mATX·ITX/드라이브 베이: 3.5"×2, 2.5"×4/팬 슬롯: 120mm×6/최대 라디에이터: 360mm/전면: USB 3.0×2, USB-C×1
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,
};

const CATEGORY_KO = {
  cpu: "CPU", gpu: "GPU", memory: "메모리", storage: "저장장치",
  motherboard: "메인보드", psu: "파워서플라이", cooler: "CPU 쿨러", case: "케이스",
};

async function callGpt(partName, category) {
  const catKey = (category || "").toLowerCase();
  const catKo = CATEGORY_KO[catKey] || "PC 부품";

  const specFmt = SPEC_FORMAT[catKey];
  const specPrompt = specFmt
    ? specFmt.replace(/\{name\}/g, partName)
    : `"${partName}" (${catKo})의 핵심 사양을 슬래시(/)로 구분하여 한 줄로 작성하세요.`;

  const reviewPrompt = `당신은 PC 부품 전문가입니다. "${partName}" (${catKo})에 대해 아래 규칙을 엄격히 따라 한줄평을 작성하세요.
규칙:
1. 이 제품 고유의 수치·특성에 근거한 핵심 장점 1가지 (클럭, VRAM 대역폭, 캐시, 공정, 벤치마크 포지션 등 구체적 수치 포함 필수)
2. 이 제품의 실제 한계 또는 단점 1가지 (경쟁 제품 대비, 발열, 전력, 플랫폼 한계 등 구체적으로)
3. 절대 금지 표현: "성능이 좋다", "가성비", "합리적", "뛰어난", "우수한" 등 모든 제품에 쓸 수 있는 범용 표현
4. 반드시 이 모델(${partName})에만 해당하는 고유 정보 포함
출력 형식(이 형식만, 다른 텍스트 없이):
장점: [구체적 수치·근거 포함한 장점], 단점: [구체적 한계]`;

  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
  const body = (prompt) => JSON.stringify({
    model: GPT_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    max_completion_tokens: 300,
  });

  const [reviewRes, specRes] = await Promise.all([
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers, body: body(reviewPrompt),
      signal: AbortSignal.timeout(30000),
    }),
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers, body: body(specPrompt),
      signal: AbortSignal.timeout(30000),
    }),
  ]);

  const [reviewData, specData] = await Promise.all([reviewRes.json(), specRes.json()]);

  if (!reviewRes.ok) throw new Error(reviewData?.error?.message || `review API 오류 ${reviewRes.status}`);
  if (!specRes.ok) throw new Error(specData?.error?.message || `spec API 오류 ${specRes.status}`);

  return {
    review: reviewData.choices?.[0]?.message?.content?.trim() || "",
    specSummary: specData.choices?.[0]?.message?.content?.trim() || "",
  };
}

async function main() {
  console.log(`\n🚀 bulk-update-specs 시작`);
  console.log(`   카테고리: ${categoryArg || "전체"}`);
  console.log(`   모드: ${overwrite ? "전체 덮어쓰기 (--overwrite)" : "불량/미존재만 처리"}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const url = new URL(MONGODB_URI);
  const dbName = url.pathname.substring(1) || "pcsite";
  const db = client.db(dbName);
  const col = db.collection("parts");

  const filter = categoryArg ? { category: categoryArg } : {};
  const parts = await col.find(filter, {
    projection: { _id: 1, name: 1, category: 1, review: 1, specSummary: 1 },
  }).toArray();

  console.log(`📦 총 ${parts.length}개 부품 로드 (DB: ${dbName})\n`);

  // 처리 대상 판별
  const toProcess = parts.filter((p) => {
    if (overwrite) return true;
    return !p.review || !isValidSpec(p.specSummary);
  });

  const skipped = parts.length - toProcess.length;
  console.log(`✅ 건너뜀 (정상): ${skipped}개`);
  console.log(`⚙️  처리 대상: ${toProcess.length}개\n`);

  if (toProcess.length === 0) {
    console.log("모든 부품이 이미 최신 상태입니다.");
    await client.close();
    return;
  }

  let updated = 0, failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const part = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta = i > 0
      ? Math.round((elapsed / i) * (toProcess.length - i))
      : "?";

    process.stdout.write(`${progress} ${part.category}/${part.name.slice(0, 40)} ... `);

    try {
      const { review, specSummary } = await callGpt(part.name, part.category);

      if (review && specSummary) {
        await col.updateOne(
          { _id: part._id },
          { $set: { review, specSummary, specUpdatedAt: new Date().toISOString() } }
        );
        updated++;
        console.log(`✅ 완료 (남은 예상: ${eta}초)`);
      } else {
        console.log("⚠️  빈 응답 건너뜀");
        failed++;
      }
    } catch (e) {
      console.log(`❌ 실패: ${e.message}`);
      failed++;
    }

    await sleep(500); // OpenAI rate limit 대응
  }

  await client.close();

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n🎉 완료! (총 ${totalSec}초)`);
  console.log(`   업데이트: ${updated}개 / 실패: ${failed}개 / 건너뜀: ${skipped}개`);
}

main().catch((e) => {
  console.error("❌ 오류:", e.message);
  process.exit(1);
});
