import { z } from "zod";

export function validate(schema, target = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      return res.status(400).json({ error: "입력값이 올바르지 않습니다.", details: issues });
    }
    req[target] = result.data;
    next();
  };
}
