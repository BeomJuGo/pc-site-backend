import { describe, it, expect } from "vitest";
import { extractCriticalTokens, validateNaverPrice } from "../../utils/priceValidator.js";

// ── extractCriticalTokens ──────────────────────────────────────────────────

describe("extractCriticalTokens", () => {
  it("복합 모델 번호 추출 (w7-3465X)", () => {
    const tokens = extractCriticalTokens("인텔 제온 w7-3465X");
    expect(tokens).toContain("w7-3465x");
    expect(tokens).toContain("3465x");
  });

  it("숫자 모델 번호 추출 (3950X)", () => {
    const tokens = extractCriticalTokens("AMD 라이젠9-3세대 3950X (마티스)");
    expect(tokens).toContain("3950x");
  });

  it("한국어 세대 구분자는 토큰으로 추출되지 않음", () => {
    const tokens = extractCriticalTokens("AMD 라이젠9-3세대 3950X");
    // "9", "3" 단독 숫자(4자리 미만)는 포함되지 않아야 함
    expect(tokens).not.toContain("9");
    expect(tokens).not.toContain("3");
  });

  it("GPU 모델 번호 추출 (4090)", () => {
    const tokens = extractCriticalTokens("NVIDIA 지포스 RTX 4090");
    expect(tokens).toContain("4090");
  });

  it("인텔 코어 복합 모델 (i9-14900K)", () => {
    const tokens = extractCriticalTokens("인텔 코어 i9-14900K");
    expect(tokens).toContain("i9-14900k");
    expect(tokens).toContain("14900k");
  });

  it("토큰 추출 불가 시 빈 배열 반환", () => {
    const tokens = extractCriticalTokens("삼성 SSD 일반형");
    expect(tokens).toHaveLength(0);
  });
});

// ── validateNaverPrice: 버그 재현 케이스 ──────────────────────────────────

describe("validateNaverPrice - 잘못된 제품 필터링 (버그 재현)", () => {
  it("❌ 인텔 제온 w7-3465X 검색에 E5 2640V3 결과 → valid: false", () => {
    const items = [
      { title: "인텔 제온 E5 2640V3 2640 V3 서버 CPU", lprice: "19110" },
      { title: "인텔 제온 E5 2640V3", lprice: "23310" },
    ];
    const result = validateNaverPrice("인텔 제온 w7-3465X", items);
    expect(result.valid).toBe(false);
    expect(result.matchedCount).toBe(0);
  });

  it("❌ AMD 3950X 검색에 3300X 결과 → valid: false", () => {
    const items = [{ title: "AMD 라이젠3-3세대 3300X (마티스)", lprice: "120000" }];
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X (마티스)", items);
    expect(result.valid).toBe(false);
    expect(result.matchedCount).toBe(0);
  });

  it("❌ AMD 3950X 검색에 3600 결과 → valid: false", () => {
    const items = [{ title: "<b>AMD</b> 라이젠3-3세대 3600 CPU", lprice: "100000" }];
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X (마티스)", items);
    expect(result.valid).toBe(false);
    expect(result.matchedCount).toBe(0);
  });
});

// ── validateNaverPrice: 정상 매칭 ─────────────────────────────────────────

describe("validateNaverPrice - 정상 제품 매칭", () => {
  it("✅ 인텔 제온 w7-3465X 정확한 결과 → valid: true", () => {
    const items = [
      { title: "인텔 제온 w7-3465X 프로세서 정품", lprice: "4500000" },
      { title: "Intel Xeon w7-3465X OEM", lprice: "4800000" },
    ];
    const result = validateNaverPrice("인텔 제온 w7-3465X", items);
    expect(result.valid).toBe(true);
    expect(result.price).toBe(4500000);
    expect(result.matchedCount).toBe(2);
  });

  it("✅ AMD 3950X 정확한 결과 → valid: true", () => {
    const items = [
      { title: "AMD 라이젠9-3세대 3950X (마티스) 정품", lprice: "350000" },
    ];
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X (마티스)", items);
    expect(result.valid).toBe(true);
    expect(result.price).toBe(350000);
  });

  it("✅ HTML 태그 포함된 타이틀도 정상 매칭", () => {
    const items = [{ title: "<b>AMD</b> 라이젠9 <b>3950X</b> 마티스", lprice: "360000" }];
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X (마티스)", items);
    expect(result.valid).toBe(true);
    expect(result.price).toBe(360000);
  });

  it("✅ 혼합 결과에서 정확한 아이템만 가격 집계", () => {
    const items = [
      { title: "AMD 라이젠3-3세대 3300X (마티스)", lprice: "80000" },
      { title: "AMD 라이젠9-3세대 3950X (마티스) 정품", lprice: "350000" },
    ];
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X (마티스)", items);
    expect(result.valid).toBe(true);
    expect(result.price).toBe(350000);
    expect(result.matchedCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });
});

// ── validateNaverPrice: 가격 범위 이탈 체크 ──────────────────────────────

describe("validateNaverPrice - 가격 범위 이탈", () => {
  it("❌ 기준가 4,813,900원에 19,110원 반환 → valid: false", () => {
    const items = [{ title: "인텔 제온 w7-3465X 정품", lprice: "19110" }];
    const result = validateNaverPrice("인텔 제온 w7-3465X", items, 4813900);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/가격 범위 초과/);
    expect(result.price).toBe(19110);
  });

  it("❌ 기준가 대비 4배 초과 → valid: false", () => {
    const items = [{ title: "인텔 제온 w7-3465X", lprice: "20000000" }];
    const result = validateNaverPrice("인텔 제온 w7-3465X", items, 4813900);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/가격 범위 초과/);
  });

  it("✅ 기준가 대비 정상 범위 (2배 이내) → valid: true", () => {
    const items = [{ title: "인텔 제온 w7-3465X 정품", lprice: "5000000" }];
    const result = validateNaverPrice("인텔 제온 w7-3465X", items, 4813900);
    expect(result.valid).toBe(true);
  });
});

// ── validateNaverPrice: 엣지 케이스 ──────────────────────────────────────

describe("validateNaverPrice - 엣지 케이스", () => {
  it("⚠️ 토큰 추출 불가 시 가격 범위만 체크 (pass-through)", () => {
    const items = [{ title: "삼성 SSD 일반형 제품명불명", lprice: "150000" }];
    const result = validateNaverPrice("삼성 SSD 일반형", items);
    expect(result.valid).toBe(true);
    expect(result.matchedCount).toBe(1);
  });

  it("빈 items 배열 → valid: false", () => {
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X", []);
    expect(result.valid).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it("referencePrice 없으면 가격 범위 체크 건너뜀", () => {
    const items = [{ title: "인텔 제온 w7-3465X", lprice: "100" }];
    const result = validateNaverPrice("인텔 제온 w7-3465X", items, null);
    expect(result.valid).toBe(true);
  });

  it("parsed 아이템 형식 (lprice 대신 price 필드)도 처리", () => {
    const items = [{ title: "AMD 라이젠9-3세대 3950X 정품", price: 350000 }];
    const result = validateNaverPrice("AMD 라이젠9-3세대 3950X", items);
    expect(result.valid).toBe(true);
    expect(result.price).toBe(350000);
  });
});
