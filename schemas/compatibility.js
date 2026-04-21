import { z } from "zod";

const partName = z.string().min(1).max(200).optional();

export const compatibilityCheckSchema = z.object({
  parts: z
    .object({
      cpu: partName,
      gpu: partName,
      motherboard: partName,
      memory: partName,
      psu: partName,
      cooler: partName,
      storage: partName,
      case: partName,
    })
    .refine((p) => Object.values(p).some(Boolean), {
      message: "최소 하나 이상의 부품을 지정해야 합니다.",
    }),
});
