import "dotenv/config";
import { connectDB } from "../db.js";
import { runSync } from "../routes/syncCPUs.js";

const pages = parseInt(process.env.PAGES || "15");
const benchPages = parseInt(process.env.BENCH_PAGES || "10");
const ai = process.env.AI !== "false";
const force = process.env.FORCE === "true";

try {
  await connectDB();
  await runSync({ pages, benchPages, ai, force });
  process.exit(0);
} catch (err) {
  console.error("❌ CPU 동기화 실패:", err);
  process.exit(1);
}
