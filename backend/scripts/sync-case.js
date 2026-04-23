import "dotenv/config";
import { connectDB } from "../db.js";
import { runSync } from "../routes/syncCASE.js";

const pages = parseInt(process.env.PAGES || "10");
const ai = process.env.AI !== "false";
const force = process.env.FORCE === "true";

try {
  await connectDB();
  await runSync({ pages, ai, force });
  process.exit(0);
} catch (err) {
  console.error("❌ 케이스 동기화 실패:", err);
  process.exit(1);
}
