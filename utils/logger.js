import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, errors } = format;

const logFormat = printf(({ timestamp, level, message, stack }) =>
  stack
    ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`
    : `${timestamp} [${level.toUpperCase()}] ${message}`
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [new transports.Console()],
});

export default logger;
