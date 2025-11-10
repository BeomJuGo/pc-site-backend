# PC 사이트 백엔드 개선 사항

## 1. 입력 검증 강화

### 문제점
- `recommend.js`에서 `purpose` 값 검증 없음
- `budget` 타입 검증 부족
- DB 연결 실패 시 에러 처리 미흡

### 개선 방안
```javascript
// routes/recommend.js
router.post("/", async (req, res) => {
  try {
    const { budget, purpose } = req.body;

    // 입력 검증 강화
    if (!budget || typeof budget !== 'number' || isNaN(budget)) {
      return res.status(400).json({ 
        error: "잘못된 예산 값입니다.",
        message: "예산은 숫자여야 합니다."
      });
    }

    if (budget < 500000 || budget > 50000000) {
      return res.status(400).json({ 
        error: "예산 범위를 벗어났습니다.",
        message: "예산은 50만원 이상 5천만원 이하여야 합니다."
      });
    }

    const validPurposes = ["게임용", "작업용", "사무용", "가성비"];
    if (!purpose || !validPurposes.includes(purpose)) {
      return res.status(400).json({ 
        error: "잘못된 용도입니다.",
        message: `용도는 다음 중 하나여야 합니다: ${validPurposes.join(", ")}`,
        validPurposes
      });
    }

    const db = getDB();
    if (!db) {
      return res.status(500).json({ 
        error: "데이터베이스 연결 실패",
        message: "서버에 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
      });
    }
    // ... 나머지 코드
  }
});
```

## 2. 에러 로깅 개선

### 문제점
- 에러 발생 시 상세 정보 부족
- 프로덕션 환경에서 민감한 정보 노출 가능

### 개선 방안
```javascript
// winston 또는 pino 같은 로깅 라이브러리 사용
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// 에러 처리 시
catch (error) {
  logger.error('추천 요청 실패', {
    error: error.message,
    stack: error.stack,
    budget,
    purpose,
    timestamp: new Date().toISOString()
  });

  res.status(500).json({
    error: "추천 생성 실패",
    message: process.env.NODE_ENV === 'production' 
      ? "서버에 문제가 발생했습니다." 
      : error.message
  });
}
```

## 3. 성능 최적화

### 문제점
- 모든 부품을 메모리에 로드 (메모리 사용량 증가)
- AI 평가 생성 시 순차적 처리 가능성

### 개선 방안
```javascript
// 인덱싱 추가
// db.js에 인덱스 생성 로직 추가
await col.createIndex({ category: 1, price: 1 });
await col.createIndex({ category: 1, "benchmarkScore.passmarkscore": -1 });
await col.createIndex({ category: 1, "benchmarkScore.3dmarkscore": -1 });

// 필요한 필드만 조회
const cpus = await col.find(
  { category: "cpu", price: { $gt: 0 } },
  { projection: { name: 1, price: 1, image: 1, benchmarkScore: 1, specSummary: 1, info: 1 } }
).toArray();
```

## 4. API 응답 형식 표준화

### 문제점
- 에러 응답 형식이 일관되지 않음
- 성공 응답에 불필요한 정보 포함

### 개선 방안
```javascript
// utils/response.js 생성
export const successResponse = (data, message = "성공") => ({
  success: true,
  message,
  data,
  timestamp: new Date().toISOString()
});

export const errorResponse = (error, message, statusCode = 500) => ({
  success: false,
  error,
  message,
  timestamp: new Date().toISOString()
});

// 사용 예시
res.status(200).json(successResponse(buildsWithAI, "추천 완료"));
res.status(400).json(errorResponse("INVALID_BUDGET", "예산이 올바르지 않습니다.", 400));
```

## 5. 타임아웃 설정

### 문제점
- AI 평가 생성 시 타임아웃 없음
- 크롤링 작업에 타임아웃 없음

### 개선 방안
```javascript
// Promise.race를 사용한 타임아웃
const timeout = (ms) => new Promise((_, reject) => 
  setTimeout(() => reject(new Error('타임아웃')), ms)
);

// AI 평가 생성 시
const aiEvaluation = await Promise.race([
  generateBuildEvaluation(buildData, purpose, budget),
  timeout(30000) // 30초 타임아웃
]).catch(err => {
  console.error('AI 평가 타임아웃:', err);
  return { evaluation: "", strengths: [], recommendations: [] };
});
```

## 6. 캐싱 추가

### 문제점
- 동일한 요청에 대해 매번 DB 조회
- AI 평가 결과 재사용 불가

### 개선 방안
```javascript
// redis 또는 node-cache 사용
import NodeCache from 'node-cache';
const cache = new NodeCache({ stdTTL: 3600 }); // 1시간 캐시

// 추천 결과 캐싱
const cacheKey = `recommend:${budget}:${purpose}`;
const cached = cache.get(cacheKey);
if (cached) {
  return res.json(cached);
}

// 결과 생성 후 캐싱
const result = { builds: buildsWithAI, ... };
cache.set(cacheKey, result);
```

## 7. 환경 변수 검증

### 문제점
- 필수 환경 변수 누락 시 런타임 에러 발생
- 에러 메시지가 명확하지 않음

### 개선 방안
```javascript
// config.js 생성
import dotenv from 'dotenv';
dotenv.config();

const requiredEnvVars = [
  'MONGODB_URI',
  'OPENAI_API_KEY'
];

const missing = requiredEnvVars.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ 필수 환경 변수가 누락되었습니다:', missing);
  process.exit(1);
}

export const config = {
  mongodbUri: process.env.MONGODB_URI,
  openaiApiKey: process.env.OPENAI_API_KEY,
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development'
};
```

## 8. 데이터베이스 쿼리 최적화

### 문제점
- 모든 부품을 한 번에 메모리에 로드
- 불필요한 필드까지 조회

### 개선 방안
```javascript
// 필요한 필드만 조회
const projection = {
  name: 1,
  price: 1,
  image: 1,
  benchmarkScore: 1,
  specSummary: 1,
  info: 1,
  category: 1
};

const [cpus, gpus, ...] = await Promise.all([
  col.find({ category: "cpu", price: { $gt: 0 } }, { projection }).toArray(),
  col.find({ category: "gpu", price: { $gt: 0 } }, { projection }).toArray(),
  // ...
]);
```

## 9. API 문서화 (Swagger/OpenAPI)

### 개선 방안
```javascript
// swagger.js 또는 swagger.yaml 추가
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PC 사이트 API',
      version: '1.0.0',
      description: 'PC 부품 추천 API',
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: '개발 서버',
      },
    ],
  },
  apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

## 10. 요청 제한 (Rate Limiting)

### 개선 방안
```javascript
import rateLimit from 'express-rate-limit';

const recommendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 50, // 최대 50회 요청
  message: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.'
});

router.post("/", recommendLimiter, async (req, res) => {
  // ...
});
```

## 우선순위

1. **높음**: 입력 검증 강화, 에러 처리 개선
2. **중간**: 성능 최적화, 타임아웃 설정
3. **낮음**: 캐싱, API 문서화, Rate Limiting

