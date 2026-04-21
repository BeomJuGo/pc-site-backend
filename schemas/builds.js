import { z } from "zod";

export const createBuildSchema = z.object({
  builds: z
    .array(z.record(z.unknown()), { required_error: "builds 배열이 필요합니다." })
    .min(1, "builds가 비어있습니다.")
    .max(10, "최대 10개 견적까지 저장 가능합니다."),
  budget: z
    .number({ required_error: "budget이 필요합니다.", invalid_type_error: "budget은 숫자여야 합니다." })
    .positive("budget은 양수여야 합니다."),
  purpose: z.string().max(50).optional(),
});
