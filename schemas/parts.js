import { z } from "zod";

const VALID_CATEGORIES = ["cpu", "gpu", "memory", "motherboard", "storage", "psu", "case", "cooler"];

export const partsQuerySchema = z.object({
  category: z.enum(VALID_CATEGORIES).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const valueRankQuerySchema = z.object({
  category: z.enum(VALID_CATEGORIES, { errorMap: () => ({ message: `category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.` }) }),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const budgetPicksQuerySchema = z.object({
  budget: z.coerce
    .number({ invalid_type_error: "budget은 숫자여야 합니다." })
    .int()
    .min(500000, "최소 예산은 500,000원입니다.")
    .max(50000000, "최대 예산은 50,000,000원입니다."),
});

export const batchQuerySchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(VALID_CATEGORIES),
        name: z.string().min(1).max(200),
      })
    )
    .min(1, "items가 비어있습니다.")
    .max(50, "최대 50개까지 조회 가능합니다."),
});

export const naverPriceQuerySchema = z.object({
  query: z.string({ required_error: "query 파라미터가 필요합니다." }).min(1).max(200),
});

export const gptInfoSchema = z.object({
  partName: z.string({ required_error: "partName이 필요합니다." }).min(1).max(200),
});

export const searchQuerySchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    category: z.enum(VALID_CATEGORIES).optional(),
    manufacturer: z.string().max(100).optional(),
    priceMin: z.coerce.number().int().nonnegative().optional(),
    priceMax: z.coerce.number().int().positive().optional(),
    sort: z.enum(["price_asc", "price_desc", "score_desc", "value_desc"]).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .refine((d) => d.q || d.category, { message: "q 또는 category 중 하나는 필요합니다." });

export const priceCheckSchema = z.object({
  parts: z
    .array(
      z.object({
        category: z.enum(VALID_CATEGORIES),
        name: z.string().min(1).max(200),
      })
    )
    .min(1, "parts가 비어있습니다.")
    .max(8, "최대 8개까지 일괄 조회 가능합니다."),
});

export const compareSchema = z.object({
  parts: z
    .array(
      z.object({
        category: z.enum(VALID_CATEGORIES),
        name: z.string().min(1).max(200),
      })
    )
    .min(2, "최소 2개 부품이 필요합니다.")
    .max(5, "최대 5개까지 비교 가능합니다."),
});
