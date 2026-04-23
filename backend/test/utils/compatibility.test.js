import { describe, it, expect } from "vitest";

// Pure utility functions extracted for testing
// (inline copies — if these are refactored to exports, import directly)

function normalizeSocket(s) {
  if (!s) return "";
  const n = s.toUpperCase().replace(/[\s-]/g, "");
  if (/LGA115[0-9X]/.test(n)) return "LGA1151";
  return n;
}

function extractDdr(text = "") {
  const m = text.toUpperCase().match(/DDR\s*([45])/);
  return m ? `DDR${m[1]}` : "";
}

function extractWatt(text = "") {
  const m = text.match(/(\d{2,4})\s*W(?:att)?/i);
  return m ? parseInt(m[1]) : 0;
}

function detectFormFactor(text = "") {
  const t = text.toUpperCase().replace(/[\s-]/g, "");
  if (/EATX/.test(t)) return "E-ATX";
  if (/MINIITX/.test(t)) return "Mini-ITX";
  if (/MICROATX|MATX/.test(t)) return "mATX";
  if (/ATX/.test(t)) return "ATX";
  return "";
}

describe("normalizeSocket", () => {
  it("LGA1700 유지", () => expect(normalizeSocket("LGA1700")).toBe("LGA1700"));
  it("AM5 유지", () => expect(normalizeSocket("AM5")).toBe("AM5"));
  it("LGA1151 정규화", () => expect(normalizeSocket("LGA1150")).toBe("LGA1151"));
  it("빈 값 처리", () => expect(normalizeSocket("")).toBe(""));
  it("null 처리", () => expect(normalizeSocket(null)).toBe(""));
});

describe("extractDdr", () => {
  it("DDR5 감지", () => expect(extractDdr("삼성 DDR5 32GB")).toBe("DDR5"));
  it("DDR4 감지", () => expect(extractDdr("DDR4-3200")).toBe("DDR4"));
  it("공백 포함 DDR 5", () => expect(extractDdr("DDR 5")).toBe("DDR5"));
  it("없으면 빈 문자열", () => expect(extractDdr("메모리 16GB")).toBe(""));
});

describe("extractWatt", () => {
  it("W 단위 추출", () => expect(extractWatt("850W")).toBe(850));
  it("Watt 단위 추출", () => expect(extractWatt("750Watt")).toBe(750));
  it("공백 포함", () => expect(extractWatt("1000 W")).toBe(1000));
  it("없으면 0", () => expect(extractWatt("SSD 1TB")).toBe(0));
});

describe("detectFormFactor", () => {
  it("ATX 감지", () => expect(detectFormFactor("ATX 메인보드")).toBe("ATX"));
  it("mATX 감지", () => expect(detectFormFactor("Micro ATX")).toBe("mATX"));
  it("Mini-ITX 감지", () => expect(detectFormFactor("Mini-ITX")).toBe("Mini-ITX"));
  it("E-ATX 감지", () => expect(detectFormFactor("E-ATX")).toBe("E-ATX"));
  it("없으면 빈 문자열", () => expect(detectFormFactor("Z790 칩셋")).toBe(""));
});
