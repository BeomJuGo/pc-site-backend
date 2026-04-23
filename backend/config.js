// config.js - 환경 변수 설정 관리
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  mongodbUri: process.env.MONGODB_URI,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  port: parseInt(process.env.PORT || '10000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        "https://goodpricepc.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
      ],

  apiTimeouts: {
    aiEvaluation: 30000,
    crawling: 60000,
  },

  validation: {
    minBudget: 500000,
    maxBudget: 50000000,
    validPurposes: ["게임용", "작업용", "사무용", "가성비"],
  },
};

export default config;
