import { z } from "zod";

const VALID_CATEGORIES = ["cpu", "gpu", "memory", "motherboard", "storage", "psu", "case", "cooler"];

export const upgradeAdvisorSchema = z.object({
  currentBuild: z
    .object({
      cpu: z.string().max(200).optional(),
      gpu: z.string().max(200).optional(),
      motherboard: z.string().max(200).optional(),
      memory: z.string().max(200).optional(),
      storage: z.string().max(200).optional(),
    })
    .refine((b) => Object.values(b).some(Boolean), { message: "currentBuild에 부품이 최소 1개 필요합니다." }),
  budget: z
    .number({ required_error: "budget이 필요합니다.", invalid_type_error: "budget은 숫자여야 합니다." })
    .int()
    .min(100000, "최소 예산은 100,000원입니다.")
    .max(10000000, "최대 예산은 10,000,000원입니다."),
  purpose: z
    .enum(["게임용", "작업용", "사무용", "가성비"], {
      errorMap: () => ({ message: "purpose는 게임용|작업용|사무용|가성비 중 하나여야 합니다." }),
    })
    .optional(),
});

export const recommendV2Schema = z.object({
  budget: z.coerce
    .number({ invalid_type_error: "budget은 숫자여야 합니다." })
    .int()
    .min(500000, "최소 예산은 500,000원입니다.")
    .max(2000000, "최대 예산은 2,000,000원입니다.")
    .refine((v) => v % 100000 === 0, "budget은 10만원 단위여야 합니다."),
});

export const recommendSchema = z.object({
  budget: z
    .number({ required_error: "budget이 필요합니다.", invalid_type_error: "budget은 숫자여야 합니다." })
    .int()
    .min(500000, "최소 예산은 500,000원입니다.")
    .max(50000000, "최대 예산은 50,000,000원입니다."),
  purpose: z.enum(["게임용", "작업용", "사무용", "가성비"], {
    errorMap: () => ({ message: "purpose는 게임용|작업용|사무용|가성비 중 하나여야 합니다." }),
  }),
});
