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

const lockedPartEntry = z.object({
  name: z.string().min(1).max(200),
  price: z.coerce.number().int().min(0).max(10000000).optional().default(0),
});

export const recommendV2CustomSchema = recommendV2Schema.extend({
  lockedParts: z.object({
    cpu:         lockedPartEntry.optional(),
    gpu:         lockedPartEntry.optional(),
    motherboard: lockedPartEntry.optional(),
    memory:      lockedPartEntry.optional(),
    storage:     lockedPartEntry.optional(),
    psu:         lockedPartEntry.optional(),
    cooler:      lockedPartEntry.optional(),
    case:        lockedPartEntry.optional(),
  }).optional().default({}),
});
