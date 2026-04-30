// config.js - 환경 변수 검증 및 설정 관리
import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'MONGODB_URI',
  'ADMIN_API_KEY',
];

const missing = requiredEnvVars.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ 필수 환경 변수가 누락되었습니다:');
  missing.forEach(key => {
    console.error(`   - ${key}`);
  });
  console.error('\n💡 .env 파일을 확인하거나 환경 변수를 설정해주세요.');
  process.exit(1);
}

export const config = {
  mongodbUri: process.env.MONGODB_URI,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  adminApiKey: process.env.ADMIN_API_KEY,
  port: parseInt(process.env.PORT || '10000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        "https://goodpricepc.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
        ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
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

if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
  console.warn('⚠️ NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정: 네이버 쇼핑 API 비활성화');
}

if (config.nodeEnv !== 'production') {
  console.log('✅ 환경 변수 검증 완료');
  console.log(`   - MongoDB URI: ${config.mongodbUri ? '설정됨' : '미설정'}`);
  console.log(`   - OpenAI API Key: ${config.openaiApiKey ? '설정됨' : '미설정 (AI 기능 비활성화)'}`);
  console.log(`   - Admin API Key: ${config.adminApiKey ? '설정됨' : '미설정'}`);
  console.log(`   - 포트: ${config.port}`);
  console.log(`   - 환경: ${config.nodeEnv}`);
}

export default config;
