# PLANKING v2

PLANKING은 그리온이 클라이언트의 **네이버 플레이스 자연 노출 순위**를 반복 관측하고 변화 이력을 관리하기 위한 운영 서비스입니다.

## 핵심 원칙

- 매장은 상호명이 아니라 **Naver Place ID**로 식별합니다.
- 광고 결과는 자연 순위에서 제외합니다.
- 기본 TOP 100, 키워드별 최대 TOP 300까지 탐색할 수 있습니다.
- `100위 밖`과 `수집 실패`를 분리합니다.
- 순위는 동일 수집 환경에서의 관측값이며 사용자 위치·개인화·시간에 따라 실제 검색 결과와 차이가 날 수 있습니다.

## 구성

```text
Next.js Web (Vercel)
       ↓
Supabase Auth / Postgres / RLS / Queue
       ↑
Playwright Rank Collector
       ↑
GitHub Actions Scheduler (09:00 / 18:00 KST)
```

Web은 Chromium을 실행하지 않습니다. 수집은 별도 Worker가 담당합니다.

## 주요 기능

### 그리온 관리자/직원

- 클라이언트 등록
- 업체 + Naver Place ID 등록
- 업체별 키워드 등록
- TOP 100~300 탐색 범위 설정
- 수동 순위 수집 요청
- 수집 작업 상태 확인
- 클라이언트 이메일 초대 및 업체별 조회 권한 부여

### 클라이언트

- 허용된 자기 업체만 조회
- 현재 순위
- 직전 / 7일 / 30일 변화
- TOP 3 / TOP 10 / TOP 20 키워드 수
- 최근 순위 추이

## 저장소 구조

```text
apps/web/                 Next.js 대시보드
packages/core/            순위 상태/도메인 계약
packages/db/              DB 계약
workers/rank-collector/   Playwright 수집 Worker
supabase/migrations/      DB + RLS + Queue RPC
docs/operations/          배포/운영 문서
```

## 개발 검증

```bash
npm install
npm test
npm run check
```

## 배포

- Web: Vercel Root Directory `apps/web`
- DB/Auth: Supabase
- Collector: Chromium 실행이 가능한 VM/컨테이너
- Schedule: GitHub Actions

자세한 배포 절차는 `docs/operations/DEPLOYMENT.md`를 참고합니다.
