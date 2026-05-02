import { z } from "zod";

const VALID_CATEGORIES = ["cpu", "gpu", "memory", "motherboard", "storage", "psu", "cooler", "case"];

export const createAlertSchema = z.object({
  category: z.enum(VALID_CATEGORIES, { required_error: "category가 필요합니다.", invalid_type_error: "유효하지 않은 카테고리입니다." }),
  name: z.string({ required_error: "name이 필요합니다." }).min(1).max(200),
  targetPrice: z
    .number({ required_error: "targetPrice가 필요합니다.", invalid_type_error: "targetPrice는 숫자여야 합니다." })
    .positive("targetPrice는 양수여야 합니다."),
  email: z
    .string({ required_error: "email이 필요합니다." })
    .email("유효하지 않은 이메일 형식입니다."),
});

export const getAlertsQuerySchema = z.object({
  email: z.string({ required_error: "email 파라미터가 필요합니다." }).email("유효하지 않은 이메일 형식입니다."),
});
