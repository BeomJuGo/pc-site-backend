import logger from "./logger.js";
import { getRedisClient } from "./responseCache.js";

let queues = {};
let workers = {};
let useBullMQ = false;

export async function initJobQueue() {
  if (!getRedisClient()?.isReady) {
    logger.info("BullMQ 비활성화 (Redis 없음) - setInterval/cron 사용");
    return false;
  }
  try {
    await import("bullmq");
    useBullMQ = true;
    logger.info("BullMQ 활성화");
    return true;
  } catch (e) {
    logger.warn(`BullMQ 초기화 실패: ${e.message}`);
    return false;
  }
}

export async function scheduleRepeating(name, intervalMs, handler) {
  if (useBullMQ) {
    const { Queue, Worker } = await import("bullmq");
    const connection = { url: process.env.REDIS_URL };

    queues[name] = new Queue(name, { connection });
    await queues[name].add(name, {}, {
      repeat: { every: intervalMs },
      removeOnComplete: 10,
      removeOnFail: 5,
    });

    workers[name] = new Worker(name, async () => {
      await handler();
    }, { connection, concurrency: 1 });

    workers[name].on("failed", (job, err) =>
      logger.error(`BullMQ 잡 실패 [${name}]: ${err.message}`)
    );

    logger.info(`BullMQ 잡 등록: ${name} (${Math.round(intervalMs / 60000)}분 간격)`);
  } else {
    setInterval(handler, intervalMs);
    logger.info(`setInterval 등록: ${name} (${Math.round(intervalMs / 60000)}분 간격)`);
  }
}

export async function scheduleCron(name, cronExpr, handler) {
  if (useBullMQ) {
    const { Queue, Worker } = await import("bullmq");
    const connection = { url: process.env.REDIS_URL };

    queues[name] = new Queue(name, { connection });
    await queues[name].add(name, {}, {
      repeat: { pattern: cronExpr, tz: "Asia/Seoul" },
      removeOnComplete: 10,
      removeOnFail: 5,
    });

    workers[name] = new Worker(name, async () => {
      await handler();
    }, { connection, concurrency: 1 });

    workers[name].on("failed", (job, err) =>
      logger.error(`BullMQ 잡 실패 [${name}]: ${err.message}`)
    );

    logger.info(`BullMQ cron 등록: ${name} (${cronExpr})`);
  } else {
    const { default: cron } = await import("node-cron");
    cron.schedule(cronExpr, handler, { timezone: "Asia/Seoul" });
    logger.info(`node-cron 등록: ${name} (${cronExpr})`);
  }
}

export async function closeJobQueue() {
  await Promise.all([
    ...Object.values(workers).map((w) => w.close?.()),
    ...Object.values(queues).map((q) => q.close?.()),
  ]);
}
