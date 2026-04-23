import "dotenv/config";
import { connectDB } from "../db.js";
import { checkPriceAlerts } from "../routes/alerts.js";
import logger from "../utils/logger.js";

await connectDB();
logger.info("가격 알림 체크 시작");
await checkPriceAlerts();
logger.info("가격 알림 체크 완료");
process.exit(0);
