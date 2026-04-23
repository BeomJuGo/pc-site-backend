import { z } from "zod";

const buildItemSchema = z.object({
  category: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  price: z.number().nonnegative().optional(),
  partName: z.string().min(1).max(200).optional(),
}).catchall(z.unknown());

export const createBuildSchema = z.object({
  builds: z
    .array(buildItemSchema, { required_error: "builds 배열이 필요합니다." })
    .min(1, "builds가 비어있습니다.")
    .max(10, "최대 10개 견적까지 저장 가능합니다."),
  budget: z
    .number({ required_error: "budget이 필요합니다.", invalid_type_error: "budget은 숫자여야 합니다." })
    .positive("budget은 양수여야 합니다."),
  purpose: z.string().max(50).optional(),
});
