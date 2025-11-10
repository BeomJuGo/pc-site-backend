# 배포 가이드 (Render + Vercel)

이 문서는 백엔드를 Render에, 프론트엔드를 Vercel에 배포하기 위한 가이드입니다.

## 📋 배포 전 체크리스트

### 백엔드 (Render)

1. ✅ **CORS 설정**: `config.js`에서 환경 변수 `ALLOWED_ORIGINS`로 관리
2. ✅ **포트 설정**: Render가 자동으로 `PORT` 환경 변수 할당 (이미 `process.env.PORT` 사용 중)
3. ⚠️ **환경 변수 설정 필요**:
   - `MONGODB_URI`: MongoDB 연결 문자열
   - `OPENAI_API_KEY`: (선택사항) AI 기능 사용 시
   - `NAVER_CLIENT_ID`: 네이버 쇼핑 API 사용 시
   - `NAVER_CLIENT_SECRET`: 네이버 쇼핑 API 사용 시
   - `ALLOWED_ORIGINS`: (선택사항) CORS 허용 도메인 (쉼표로 구분)

### 프론트엔드 (Vercel)

1. ⚠️ **API 엔드포인트 환경 변수화 필요**
2. ⚠️ **Vercel 환경 변수 설정 필요**

---

## 🔧 백엔드 수정 사항

### 1. CORS 설정 (이미 완료)

`config.js`에서 CORS origins를 환경 변수로 관리하도록 수정되었습니다:

```32:40:config.js
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
```

### 2. Render 배포 시 환경 변수 설정

Render 대시보드에서 다음 환경 변수를 설정하세요:

```
MONGODB_URI=mongodb+srv://...
OPENAI_API_KEY=sk-... (선택사항)
NAVER_CLIENT_ID=... (선택사항)
NAVER_CLIENT_SECRET=... (선택사항)
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://goodpricepc.vercel.app
```

**중요**: Render에서 서비스를 배포한 후 실제 URL을 확인하고, `ALLOWED_ORIGINS`에 Vercel 프론트엔드 URL을 추가하세요.

---

## 🔧 프론트엔드 수정 사항

### 1. API 엔드포인트 환경 변수화

프론트엔드 프로젝트의 `src/utils/api.js` 파일을 다음과 같이 수정하세요:

**수정 전:**
```javascript
const BASE_URL = "http://localhost:10000";
```

**수정 후:**
```javascript
const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:10000";
```

### 2. Vercel 환경 변수 설정

Vercel 대시보드에서 다음 환경 변수를 설정하세요:

```
REACT_APP_API_URL=https://your-backend.onrender.com
```

**중요**: `your-backend.onrender.com`을 실제 Render 백엔드 URL로 변경하세요.

---

## 🔄 GitHub Actions 워크플로우 수정

GitHub Actions 워크플로우 파일들 (`.github/workflows/*.yml`)에서 Render URL을 업데이트해야 합니다.

현재 하드코딩된 URL:
```yaml
BACKEND_URL: https://pc-site-backend.onrender.com
```

**수정 방법 1: GitHub Secrets 사용 (권장)**

1. GitHub 저장소 → Settings → Secrets and variables → Actions
2. 새 secret 추가: `RENDER_BACKEND_URL` = 실제 Render URL
3. 워크플로우 파일 수정:

```yaml
env:
  BACKEND_URL: ${{ secrets.RENDER_BACKEND_URL }}
  API_PATH: /api/sync-motherboards
  PAGES: "3"
```

**수정 방법 2: 직접 URL 변경**

각 워크플로우 파일에서 `BACKEND_URL`을 실제 Render URL로 변경:

```yaml
env:
  BACKEND_URL: https://your-actual-backend.onrender.com
```

---

## 📝 배포 순서

### 1단계: 백엔드 배포 (Render)

1. GitHub에 백엔드 코드 푸시
2. Render에서 새 Web Service 생성
3. GitHub 저장소 연결
4. 빌드 명령어: (없음 또는 `npm install`)
5. 시작 명령어: `npm start`
6. 환경 변수 설정:
   - `MONGODB_URI`
   - `OPENAI_API_KEY` (선택)
   - `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (선택)
   - `ALLOWED_ORIGINS` (프론트엔드 URL 포함)
7. 배포 완료 후 URL 확인 (예: `https://your-backend.onrender.com`)

### 2단계: 프론트엔드 수정 및 배포 (Vercel)

1. 프론트엔드 `api.js`에서 API URL을 환경 변수로 변경
2. GitHub에 프론트엔드 코드 푸시
3. Vercel에서 새 프로젝트 생성
4. GitHub 저장소 연결
5. 환경 변수 설정:
   - `REACT_APP_API_URL=https://your-backend.onrender.com`
6. 배포 완료 후 URL 확인 (예: `https://your-frontend.vercel.app`)

### 3단계: 백엔드 CORS 업데이트

1. Render 대시보드에서 환경 변수 `ALLOWED_ORIGINS` 업데이트
2. 실제 Vercel 프론트엔드 URL 추가:
   ```
   ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://goodpricepc.vercel.app
   ```
3. 서비스 재배포

### 4단계: GitHub Actions 업데이트

1. GitHub Secrets에 `RENDER_BACKEND_URL` 추가
2. 또는 각 워크플로우 파일에서 `BACKEND_URL` 직접 수정
3. 워크플로우 테스트 실행

---

## 🧪 배포 후 테스트

### 백엔드 헬스 체크

```bash
curl https://your-backend.onrender.com/api/health
```

예상 응답:
```json
{
  "status": "OK",
  "timestamp": "...",
  "uptime": ...,
  "cors": "enabled",
  "allowedOrigins": [...]
}
```

### 프론트엔드에서 API 호출 테스트

1. 브라우저 개발자 도구 → Network 탭 열기
2. 프론트엔드 사이트에서 API 호출하는 페이지 접속
3. API 요청이 성공하는지 확인
4. CORS 에러가 없는지 확인

---

## ⚠️ 주의사항

1. **Render 무료 플랜**: 
   - 서비스가 15분간 비활성화되면 자동으로 sleep 모드로 전환
   - 첫 요청 시 깨어나는데 시간이 걸릴 수 있음 (Cold Start)
   - 헬스 체크 엔드포인트(`/api/health`)를 주기적으로 호출하여 방지 가능

2. **CORS 설정**:
   - 프론트엔드 URL이 정확히 일치해야 함 (프로토콜, 도메인, 포트)
   - Vercel은 기본적으로 `https://` 사용

3. **환경 변수**:
   - 민감한 정보(API 키, 비밀번호)는 절대 코드에 하드코딩하지 마세요
   - GitHub에 `.env` 파일을 커밋하지 마세요

4. **포트 설정**:
   - Render는 자동으로 `PORT` 환경 변수를 할당
   - 코드에서 `process.env.PORT`를 사용하도록 이미 설정됨

---

## 📚 참고 자료

- [Render 문서](https://render.com/docs)
- [Vercel 문서](https://vercel.com/docs)
- [CORS 설정 가이드](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

**마지막 업데이트**: 2025년 1월

