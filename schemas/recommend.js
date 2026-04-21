import { z } from "zod";

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
