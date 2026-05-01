import { z } from "zod";

export const recommendV2Schema = z.object({
  budget: z.coerce
    .number({ invalid_type_error: "budget은 숫자여야 합니다." })
    .int()
    .min(500000, "최소 예산은 500,000원입니다.")
    .max(2000000, "최대 예산은 2,000,000원입니다.")
    .refine((v) => v % 100000 === 0, "budget은 10만원 단위여야 합니다."),
  cpuBrand: z.enum(["amd", "intel"]).optional().default("amd"),
  gpuBrand: z.enum(["amd", "nvidia"]).optional().default("nvidia"),
  purpose: z.enum(["gaming", "work"]).optional().default("gaming"),
});
