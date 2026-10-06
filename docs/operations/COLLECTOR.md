# Rank Collector 운영

## 책임 범위

Collector만 Playwright/Chromium을 실행합니다. Web/Vercel은 수집 작업을 만들고 결과를 읽는 역할만 합니다.

## 실행

```bash
npm install
npx playwright install chromium
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm start --workspace @planking/rank-collector
```

## 환경 변수

- `SUPABASE_URL`: Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: service role key
- `HEADLESS`: 기본 `true`
- `NAVER_TIMEOUT_MS`: 기본 `45000`
- `WORKER_POLL_MS`: 큐가 비었을 때 대기, 기본 `5000`

## 결과 상태

- `FOUND`: 범위 안에서 Place ID 발견
- `OUT_OF_RANGE`: 정상 수집을 완료했으나 범위 안에 없음
- `BLOCKED`: 차단/캡차 감지
- `TIMEOUT`: 네비게이션 또는 수집 시간 초과
- `PARSE_ERROR`: 네이버 구조 변경 등으로 정상 결과 확인 불가
- `FAILED`: 그 외 오류

실패 상태는 절대 숫자 순위로 저장하지 않습니다.

## 운영 원칙

- 기본 최대 탐색 범위는 TOP 100입니다.
- 키워드별 최대 300까지 설정할 수 있지만 호출량과 실행 시간이 증가합니다.
- 자동수집은 하루 2회가 기본입니다.
- 수동수집은 5분 쿨다운과 활성 작업 중복 방지를 적용합니다.
- 검색 위치/개인화 영향을 완전히 제거할 수 없으므로 절대 순위 보장 도구가 아니라 동일 환경의 변화 추적 도구로 해석합니다.

## 장애 점검

`BLOCKED`가 급증하면 요청량을 늘리지 말고 Worker를 중지한 뒤 네이버 응답을 확인합니다. `PARSE_ERROR`가 급증하면 DOM/Apollo 구조 변경 여부를 확인하고 parser 회귀 테스트를 추가한 뒤 수정합니다.
