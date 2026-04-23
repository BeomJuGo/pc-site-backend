import "dotenv/config";
import { connectDB } from "../db.js";
import { runSync } from "../routes/syncGPUs.js";

const pages = parseInt(process.env.PAGES || "5");
const ai = process.env.AI !== "false";
const force = process.env.FORCE === "true";

try {
  await connectDB();
  await runSync({ pages, ai, force });
  process.exit(0);
} catch (err) {
  console.error("❌ GPU 동기화 실패:", err);
  process.exit(1);
}
