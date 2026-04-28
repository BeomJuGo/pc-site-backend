# n8n 설정 가이드

## Step 1: Railway에 n8n 배포

1. https://railway.app 접속 → 새 프로젝트 생성
2. **Add Service → Docker Image** → `n8nio/n8n` 입력
3. **Add Service → Database → PostgreSQL** 추가
4. n8n 서비스 환경변수 설정:

```
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<강력한 비밀번호>
N8N_PORT=5678
WEBHOOK_URL=https://<railway-n8n-도메인>
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=<Railway PostgreSQL 호스트>
DB_POSTGRESDB_DATABASE=railway
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=<PostgreSQL 비밀번호>
```

5. n8n 서비스에 Volume 마운트: `/home/node/.n8n`
6. Deploy → 도메인 확인

---

## Step 2: Discord 서버 웹훅 URL 생성

Discord 서버에 채널 3개 생성:
- `#가격-알림` → 웹훅 URL → `DISCORD_ALERT_WEBHOOK`
- `#ai-캐시-업데이트` → 웹훅 URL → `DISCORD_MONITOR_WEBHOOK`  
- `#일일-리포트` → 웹훅 URL → `DISCORD_REPORT_WEBHOOK`

> 채널 설정 → 연동 → 웹훅 → 새 웹훅 → URL 복사

---

## Step 3: KakaoTalk 나에게 보내기 토큰 발급

1. https://developers.kakao.com → 내 애플리케이션 → 앱 선택
2. 카카오 로그인 활성화, `talk_message` 동의항목 설정
3. 도구 → REST API 테스트 → 토큰 발급
4. 발급된 `access_token` → n8n KakaoTalk 노드 자격증명에 등록
   - Credential 이름: `KakaoTalk API`
   - Header Name: `Authorization`
   - Header Value: `Bearer <access_token>`

> ⚠️ 액세스 토큰 만료(6시간)에 주의 — 리프레시 토큰(60일)으로 갱신 필요

---

## Step 4: n8n 워크플로우 환경변수 설정

n8n → Settings → n8n Environment Variables:

```
PC_SITE_API=https://goodpricepc.vercel.app
WEBHOOK_SECRET=<임의의 강력한 문자열>
ADMIN_API_KEY=my-secret-key-12345
DISCORD_ALERT_WEBHOOK=<Discord #가격-알림 웹훅 URL>
DISCORD_MONITOR_WEBHOOK=<Discord #ai-캐시-업데이트 웹훅 URL>
DISCORD_REPORT_WEBHOOK=<Discord #일일-리포트 웹훅 URL>
```

---

## Step 5: GitHub Actions Secrets 추가

GitHub → Settings → Secrets and variables → Actions:

```
N8N_ALERT_WEBHOOK=https://<n8n-domain>/webhook/alert-created
N8N_PRICE_DONE_WEBHOOK=https://<n8n-domain>/webhook/price-update-done
```

---

## Step 6: Vercel 환경변수 추가

Vercel 대시보드 → pc-site-backend → Settings → Environment Variables:

```
N8N_ALERT_WEBHOOK=https://<n8n-domain>/webhook/alert-created
N8N_PRICE_DONE_WEBHOOK=https://<n8n-domain>/webhook/price-update-done
WEBHOOK_SECRET=<Step 4와 동일한 값>
```

---

## Step 7: n8n 워크플로우 Import

n8n 대시보드 → Workflows → Import from File:
1. `workflow-1-alert-instant-check.json`
2. `workflow-2-price-update-monitor.json`
3. `workflow-3-smart-cache-refresh.json`
4. `workflow-4-daily-report.json`

각 워크플로우 Import 후 **Active** 토글 켜기.

---

## 워크플로우 웹훅 URL 확인 방법

각 워크플로우의 Webhook 노드 클릭 → Production URL 복사:
- WF1: `https://<n8n>/webhook/alert-created`
- WF2: `https://<n8n>/webhook/price-update-done`
- WF3: `https://<n8n>/webhook/smart-cache-trigger` (수동 또는 WF2에서 호출)
- WF4: Schedule 기반 (웹훅 없음)

---

## 테스트 방법

```bash
# WF2 수동 테스트 (가격 업데이트 완료 시뮬레이션)
curl -X POST https://<n8n-domain>/webhook/price-update-done \
  -H "Content-Type: application/json" \
  -d '{"status":"success","updated":150,"skipped":10,"failed":2,"deleted":0,"timestamp":"2026-04-28T00:00:00Z"}'

# WF1 수동 테스트 (알림 즉시 체크)
curl -X POST https://<n8n-domain>/webhook/alert-created \
  -H "Content-Type: application/json" \
  -d '{"category":"cpu","name":"인텔 코어 i5-13600K","targetPrice":999999,"email":"test@example.com"}'
```
