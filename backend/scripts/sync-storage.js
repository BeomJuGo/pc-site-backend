import "dotenv/config";
import { connectDB } from "../db.js";
import { runSync } from "../routes/syncSTORAGE.js";

const pages = parseInt(process.env.PAGES || "3");
const ai = process.env.AI !== "false";
const force = process.env.FORCE === "true";

try {
  await connectDB();
  await runSync({ pages, ai, force });
  process.exit(0);
} catch (err) {
  console.error("❌ 스토리지 동기화 실패:", err);
  process.exit(1);
}
