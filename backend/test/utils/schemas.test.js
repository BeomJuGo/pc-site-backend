import { describe, it, expect } from "vitest";
import { recommendSchema } from "../../schemas/recommend.js";
import { createAlertSchema } from "../../schemas/alerts.js";
import { createBuildSchema } from "../../schemas/builds.js";
import { compatibilityCheckSchema } from "../../schemas/compatibility.js";

describe("recommendSchema", () => {
  it("유효한 요청 통과", () => {
    const r = recommendSchema.safeParse({ budget: 1000000, purpose: "게임용" });
    expect(r.success).toBe(true);
  });
  it("예산 하한 미달 거부", () => {
    const r = recommendSchema.safeParse({ budget: 100000, purpose: "게임용" });
    expect(r.success).toBe(false);
  });
  it("잘못된 용도 거부", () => {
    const r = recommendSchema.safeParse({ budget: 1000000, purpose: "방송용" });
    expect(r.success).toBe(false);
  });
  it("budget 누락 거부", () => {
    const r = recommendSchema.safeParse({ purpose: "게임용" });
    expect(r.success).toBe(false);
  });
});

describe("createAlertSchema", () => {
  it("유효한 요청 통과", () => {
    const r = createAlertSchema.safeParse({ category: "cpu", name: "라이젠 7", targetPrice: 300000, email: "test@test.com" });
    expect(r.success).toBe(true);
  });
  it("이메일 형식 오류 거부", () => {
    const r = createAlertSchema.safeParse({ category: "cpu", name: "라이젠 7", targetPrice: 300000, email: "not-an-email" });
    expect(r.success).toBe(false);
  });
  it("targetPrice 음수 거부", () => {
    const r = createAlertSchema.safeParse({ category: "cpu", name: "라이젠 7", targetPrice: -1, email: "test@test.com" });
    expect(r.success).toBe(false);
  });
});

describe("createBuildSchema", () => {
  it("유효한 요청 통과", () => {
    const r = createBuildSchema.safeParse({ builds: [{ category: "cpu", name: "AMD 라이젠 9 7950X", price: 650000 }], budget: 1000000 });
    expect(r.success).toBe(true);
  });
  it("builds 빈 배열 거부", () => {
    const r = createBuildSchema.safeParse({ builds: [], budget: 1000000 });
    expect(r.success).toBe(false);
  });
  it("11개 초과 거부", () => {
    const builds = Array(11).fill({ cpu: "test" });
    const r = createBuildSchema.safeParse({ builds, budget: 1000000 });
    expect(r.success).toBe(false);
  });
});

describe("compatibilityCheckSchema", () => {
  it("유효한 요청 통과", () => {
    const r = compatibilityCheckSchema.safeParse({ parts: { cpu: "라이젠 7 7800X3D" } });
    expect(r.success).toBe(true);
  });
  it("빈 parts 거부", () => {
    const r = compatibilityCheckSchema.safeParse({ parts: {} });
    expect(r.success).toBe(false);
  });
  it("parts 누락 거부", () => {
    const r = compatibilityCheckSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
