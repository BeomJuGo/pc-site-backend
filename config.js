// config.js - 환경 변수 검증 및 설정 관리
import dotenv from 'dotenv';

dotenv.config();

// 필수 환경 변수 목록
const requiredEnvVars = [
  'MONGODB_URI'
  // OPENAI_API_KEY는 선택사항 (AI 기능 없이도 작동 가능)
];

// 누락된 환경 변수 확인
const missing = requiredEnvVars.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ 필수 환경 변수가 누락되었습니다:');
  missing.forEach(key => {
    console.error(`   - ${key}`);
  });
  console.error('\n💡 .env 파일을 확인하거나 환경 변수를 설정해주세요.');
  process.exit(1);
}

// 설정 객체
export const config = {
  mongodbUri: process.env.MONGODB_URI,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  port: parseInt(process.env.PORT || '10000', 10), // 프론트엔드가 10000을 기대하므로 기본값 변경
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // CORS 설정
  // 환경 변수 ALLOWED_ORIGINS가 있으면 사용, 없으면 기본값 사용
  // 형식: "https://example.com,https://example2.com,http://localhost:3000"
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        "https://goodpricepc.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
      ],
  
  // API 타임아웃 설정 (밀리초)
  apiTimeouts: {
    aiEvaluation: 30000, // 30초
    crawling: 60000,     // 60초
  },
  
  // 검증 설정
  validation: {
    minBudget: 500000,      // 50만원
    maxBudget: 50000000,    // 5천만원
    validPurposes: ["게임용", "작업용", "사무용", "가성비"],
  },
};

// 환경 변수 검증 완료 로그
console.log('✅ 환경 변수 검증 완료');
console.log(`   - MongoDB URI: ${config.mongodbUri ? '설정됨' : '미설정'}`);
console.log(`   - OpenAI API Key: ${config.openaiApiKey ? '설정됨' : '미설정 (AI 기능 비활성화)'}`);
console.log(`   - 포트: ${config.port}`);
console.log(`   - 환경: ${config.nodeEnv}`);

export default config;

