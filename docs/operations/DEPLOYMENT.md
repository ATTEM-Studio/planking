# PLANKING v2 배포 가이드

## 1. Supabase

1. 새 Supabase 프로젝트 또는 기존 PLANKING 프로젝트에서 `supabase/migrations/202610060001_planking_rebuild.sql`을 적용합니다.
2. `supabase/seed.sql`을 적용해 그리온 조직을 생성합니다.
3. 최초 운영자 계정을 Supabase Auth에 생성한 뒤 `organization_members`에 `owner` 역할로 연결합니다.
4. Web용 publishable key와 server-only service role key를 준비합니다.

> `SUPABASE_SERVICE_ROLE_KEY`는 브라우저에 노출하면 안 됩니다. Vercel 서버 환경과 Collector/Scheduler에서만 사용합니다.

## 2. Vercel Web

- Repository: `ATTEM-Studio/planking`
- Root Directory: `apps/web`
- Framework: Next.js
- Node.js: 22.x

환경 변수:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — 클라이언트 초대 서버 액션 전용

Web은 Chromium을 실행하지 않습니다. 수동 조회 버튼도 DB Queue에 작업을 넣을 뿐입니다.

## 3. GitHub Actions Scheduler

Repository Secrets에 다음을 설정합니다.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`.github/workflows/rank-schedule.yml`은 매일 **09:00 / 18:00 KST**에 활성 키워드를 큐에 넣습니다. 스케줄러 자체는 순위를 수집하지 않습니다.

## 4. Collector

Collector는 Chromium 실행이 가능한 VM/컨테이너에 배포합니다. 자세한 내용은 `COLLECTOR.md`를 참고합니다.

## 5. 첫 운영 체크

1. owner 로그인
2. 클라이언트 등록
3. 업체명 + Naver Place ID 등록
4. 키워드 1개 등록
5. `지금 조회` 실행
6. `collection_jobs`에서 `PENDING → RUNNING → SUCCEEDED/OUT_OF_RANGE` 확인
7. `rank_snapshots` 생성 확인
8. 업체 상세에서 순위 표시 확인
9. 클라이언트 이메일 초대 후 해당 업체만 보이는지 확인
