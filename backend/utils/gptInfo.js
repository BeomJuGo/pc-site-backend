// utils/gptInfo.js — GPT 부품 정보 생성 (스펙 요약 + AI 한줄평)
import logger from "./logger.js";

const GPT_MODEL = "gpt-5.5";

// 카테고리별 구조화된 스펙 형식 프롬프트
const SPEC_FORMAT = {
  cpu: `"${"{name}"}" CPU의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: {브랜드}(소켓{소켓명})/{영어코어이름}({코어수}) 코어 {스레드수}스레드/지원 메모리: {DDR규격}/내장그래픽: {모델명 또는 미탑재}/기본 클럭: {base}GHz/최대 클럭: {boost}GHz/TDP: {tdp}W

예시: AMD(소켓AM4)/옥타(8) 코어 16스레드/지원 메모리: DDR4/내장그래픽: 미탑재/기본 클럭: 3.0GHz/최대 클럭: 3.7GHz/TDP: 65W
예시: 인텔(소켓LGA1700)/헥사데카(16) 코어 24스레드/지원 메모리: DDR5/내장그래픽: UHD 770/기본 클럭: 2.1GHz/최대 클럭: 5.2GHz/TDP: 125W
예시: 인텔(소켓LGA1851)/헥사데카(16) 코어 24스레드/지원 메모리: DDR5/내장그래픽: 미탑재/기본 클럭: 3.2GHz/최대 클럭: 5.7GHz/TDP: 125W

영어 코어 이름(싱글→Mono·듀얼→Dual·쿼드→Quad·헥사→Hexa·옥타→Octa·데카→Deca·도데카→Dodeca·16→Hexadeca·24→Vigi·32→Triaconta).
이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  gpu: `"${"{name}"}" GPU의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: {NVIDIA 또는 AMD}({VRAM}GB {VRAM타입})/쉐이더: {숫자}개/부스트 클럭: {MHz}MHz/TDP: {W}W/인터페이스: PCIe {버전}/출력: {포트목록}

★ 반드시 이 형식(항목명: 값)을 그대로 사용하고, 숫자만 나열하지 마세요.
예시: NVIDIA(24GB GDDR6X)/쉐이더: 16384개/부스트 클럭: 2520MHz/TDP: 450W/인터페이스: PCIe 4.0/출력: HDMI 2.1×1, DP 1.4a×3
예시: AMD(16GB GDDR6)/쉐이더: 4096개/부스트 클럭: 2615MHz/TDP: 260W/인터페이스: PCIe 4.0/출력: HDMI 2.1×1, DP 2.1×3
예시(모를 때): NVIDIA(8GB GDDR7)/쉐이더: ?개/부스트 클럭: ?MHz/TDP: ?W/인터페이스: PCIe ?/출력: ?

모르는 값은 반드시 ?로 표기하고, 항목명은 생략하지 마세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  memory: `"${"{name}"}" 메모리의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: {DDR규격}/{총용량}GB({구성, 예: 2×16GB})/동작 속도: {MHz}MHz/레이턴시: CL{cl}/전압: {V}V/{XMP 또는 EXPO 지원 여부}

예시: DDR5/32GB(2×16GB)/동작 속도: 6000MHz/레이턴시: CL36/전압: 1.35V/EXPO 지원
예시: DDR4/16GB(2×8GB)/동작 속도: 3200MHz/레이턴시: CL16/전압: 1.35V/XMP 2.0

이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  storage: `"${"{name}"}" 저장장치의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: {인터페이스(NVMe PCIe X.0 또는 SATA)}/{용량}/순차읽기: {read}MB/s/순차쓰기: {write}MB/s/폼팩터: {M.2 2280 또는 2.5인치}/캐시: {있음 또는 없음}

예시: NVMe PCIe 4.0/1TB/순차읽기: 7450MB/s/순차쓰기: 6900MB/s/폼팩터: M.2 2280/캐시: 있음
예시: SATA/2TB/순차읽기: 560MB/s/순차쓰기: 520MB/s/폼팩터: 2.5인치/캐시: 있음

이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  motherboard: `"${"{name}"}" 메인보드의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: 소켓: {소켓명}/칩셋: {칩셋}/지원 메모리: {DDR규격} {슬롯수}슬롯(최대 {최대용량}GB)/폼팩터: {ATX·mATX·ITX 등}/M.2 슬롯: {개수}개/PCIe {버전}

예시: 소켓: AM5/칩셋: B650/지원 메모리: DDR5 4슬롯(최대 128GB)/폼팩터: ATX/M.2 슬롯: 3개/PCIe 5.0
예시: 소켓: LGA1700/칩셋: Z790/지원 메모리: DDR5 4슬롯(최대 192GB)/폼팩터: ATX/M.2 슬롯: 4개/PCIe 5.0

이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  psu: `"${"{name}"}" 파워서플라이의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: 정격 출력: {W}W/효율: 80PLUS {등급}/모듈러: {풀 모듈러·세미 모듈러·논모듈러}/팬: {크기}mm/규격: {ATX·SFX 등}

예시: 정격 출력: 850W/효율: 80PLUS Gold/모듈러: 풀 모듈러/팬: 135mm/규격: ATX
예시: 정격 출력: 650W/효율: 80PLUS Bronze/모듈러: 세미 모듈러/팬: 120mm/규격: ATX

이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  cooler: `"${"{name}"}" CPU 쿨러의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: {공냉 또는 수냉(라디에이터 크기mm)}/팬: {크기}mm×{개수}개/지원 소켓: {소켓 목록}/TDP 지원: {W}W/{높이 또는 라디에이터 두께}

예시: 공냉/팬: 120mm×2개/지원 소켓: AM4·AM5·LGA1700·LGA1200/TDP 지원: 250W/높이: 158mm
예시: 수냉(360mm)/팬: 120mm×3개/지원 소켓: AM4·AM5·LGA1700/TDP 지원: 350W+/라디에이터 두께: 27mm

이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,

  case: `"${"{name}"}" PC 케이스의 실제 스펙을 아래 형식 그대로 한 줄로 작성하세요.

형식: 폼팩터: {Full·Mid·Mini 타워 등}/지원 보드: {ATX·mATX·ITX 나열}/드라이브 베이: {3.5"×n, 2.5"×n}/팬 슬롯: {120mm×n, 140mm×n 등}/최대 라디에이터: {크기}mm/{전면 패널 포트 나열}

예시: 폼팩터: 미드 타워/지원 보드: ATX·mATX·ITX/드라이브 베이: 3.5"×2, 2.5"×4/팬 슬롯: 120mm×6/최대 라디에이터: 360mm/전면: USB 3.0×2, USB-C×1
예시: 폼팩터: 미니 타워/지원 보드: mATX·ITX/드라이브 베이: 3.5"×2, 2.5"×2/팬 슬롯: 120mm×3/최대 라디에이터: 240mm/전면: USB 3.0×2

이 제품의 실제 공식 스펙만 사용하고, 모르는 값은 ?로 표기하세요. 다른 설명 없이 형식에 맞는 한 줄만 출력하세요.`,
};

const CATEGORY_KO = {
  cpu: "CPU",
  gpu: "GPU",
  memory: "메모리",
  storage: "저장장치",
  motherboard: "메인보드",
  psu: "파워서플라이",
  cooler: "CPU 쿨러",
  case: "케이스",
};

export function buildGptPrompts(partName, category) {
  const catKey = (category || "").toLowerCase();
  const catKo = CATEGORY_KO[catKey] || "PC 부품";

  // 스펙 프롬프트: 카테고리별 구조화 형식
  const specFmt = SPEC_FORMAT[catKey];
  const specPrompt = specFmt
    ? specFmt.replace(/\$\{"\{name\}"\}/g, partName).replace(/"\{name\}"/g, partName)
    : `"${partName}" (${catKo})의 핵심 사양을 슬래시(/)로 구분하여 한 줄로 작성하세요. 실제 공식 스펙 수치만 사용하세요.`;

  // 한줄평 프롬프트: 제품 고유 특성 기반
  const reviewPrompt = `당신은 PC 부품 전문가입니다. "${partName}" (${catKo})에 대해 아래 규칙을 엄격히 따라 한줄평을 작성하세요.

규칙:
1. 이 제품 고유의 수치·특성에 근거한 핵심 장점 1가지 (클럭, VRAM 대역폭, 캐시, 공정, 벤치마크 포지션 등 구체적 수치 포함 필수)
2. 이 제품의 실제 한계 또는 단점 1가지 (경쟁 제품 대비, 발열, 전력, 플랫폼 한계 등 구체적으로)
3. 절대 금지 표현: "성능이 좋다", "가성비", "합리적", "뛰어난", "우수한" 등 모든 제품에 쓸 수 있는 범용 표현
4. 반드시 이 모델(${partName})에만 해당하는 고유 정보 포함

출력 형식(이 형식만, 다른 텍스트 없이):
장점: [구체적 수치·근거 포함한 장점], 단점: [구체적 한계]`;

  return { reviewPrompt, specPrompt };
}

export async function callGptInfo(partName, category, model = GPT_MODEL, apiKey) {
  if (!apiKey) throw new Error("OPENAI_API_KEY 미설정");
  const { reviewPrompt, specPrompt } = buildGptPrompts(partName, category);

  const useCompletionTokens = model !== "gpt-4o-mini";
  const tokenParam = useCompletionTokens
    ? { max_completion_tokens: 300 }
    : { max_tokens: 300 };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const [reviewRes, specRes] = await Promise.all([
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: reviewPrompt }],
        temperature: 0.5,
        ...tokenParam,
      }),
      signal: AbortSignal.timeout(30000),
    }),
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: specPrompt }],
        temperature: 0.1,
        ...tokenParam,
      }),
      signal: AbortSignal.timeout(30000),
    }),
  ]);

  const [reviewData, specData] = await Promise.all([reviewRes.json(), specRes.json()]);

  if (!reviewRes.ok) throw new Error(reviewData?.error?.message || `review API 오류 ${reviewRes.status}`);
  if (!specRes.ok) throw new Error(specData?.error?.message || `spec API 오류 ${specRes.status}`);

  const review = reviewData.choices?.[0]?.message?.content?.trim() || "한줄평 생성 실패";
  const specSummary = specData.choices?.[0]?.message?.content?.trim() || "사양 요약 실패";

  logger.info(`GPT 정보 생성 완료: ${partName} (${model}) review=${review.length}자 spec=${specSummary.length}자`);

  return {
    review,
    specSummary,
    usage: {
      reviewTokens: reviewData.usage?.total_tokens || 0,
      specTokens: specData.usage?.total_tokens || 0,
    },
  };
}
