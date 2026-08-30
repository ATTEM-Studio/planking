# PLANKING Rank Collector v1

PLANKING의 분석 API(`/api/analyze`)와 별도로 네이버 지도 검색 결과의 오가닉 순위를 수집하는 백그라운드 서브시스템입니다. 입력은 `keyword + target MID`이고, 비로그인 데스크톱 Chromium 기준 최대 300위까지 탐색합니다.

## Architecture

```text
POST /api/rank_request
        |
        v
rank_slots + rank_jobs(PENDING)
        |
        v
long-running Node worker (concurrency 1)
        |
        v
Playwright Chromium -> Naver Map
        |
        +-- page 1: /p/api/search/allSearch
        +-- pages 2..6: pcmap-api.place.naver.com/graphql
        |
        v
exact MID match / organic rank
        |
        +-- FOUND -> rank_history UPSERT + job SUCCESS
        +-- OUT_OF_RANGE -> rank=null + job OUT_OF_RANGE
        +-- BLOCKED/TIMEOUT/FAILED -> job only, history is not overwritten
```

## Measurement contract

- Search surface: Naver Map
- Session: logged out
- Device: desktop Chromium, 1920x1080 viewport
- Ads/promotions: explicit ad markers are excluded from organic rank
- Limit: top 300
- Target identity: exact MID string equality
- `300+` means **only** `OUT_OF_RANGE` after a complete traversal
- block, timeout, parsing failure, or other incomplete traversal is never converted to `300+`

## Place metric history

순위가 `FOUND`인 경우 같은 검색 결과의 대상 MID에서 확인 가능한 플레이스 지표도 KST 날짜 기준으로 `place_metrics_history`에 UPSERT합니다.

현재 네이버 `allSearch` 응답에서는 다음 필드가 실수집으로 확인되었습니다.

```text
placeReviewCount -> 방문자 리뷰 수
reviewCount      -> 블로그 리뷰 수
```

기존/다른 응답 형태의 `visitorReviewCount`, `blogCafeReviewCount`도 우선 지원합니다. 저장 수는 `saveCount`가 실제 응답에 존재할 때만 원문 그대로 저장합니다. `87,000+`, `1,000+`, `~100` 같은 구간형 값을 숫자로 환산하거나 변화량을 임의 계산하지 않습니다. 현재 자연스러운 검색·상세 응답에서 저장 수가 확인되지 않는 경우 DB에는 `null`, UI에는 `—`로 표시합니다.

2026-08-31 KST 실수집 검증에서는 MID `1328453904`가 `visitor_review_count=635`, `blog_review_count=31`로 저장되었고 `save_count_raw`는 응답 부재로 `null`이었습니다.

## Database migration

Rank schema:

```text
supabase/migrations/202608300001_rank_tracking.sql
```

Place metric schema:

```text
supabase/migrations/202608310001_place_metrics_history.sql
```

With a linked Supabase CLI project, apply migrations with:

```bash
supabase db push
```

Alternatively, review and run the migrations in the Supabase SQL editor. Browser roles do not receive table access; server operations use the service role only.

## Required environment variables

The enqueue API and worker require server-side credentials only:

```text
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Worker tuning variables are optional:

```text
RANK_WORKER_IDLE_MS=5000
RANK_WORKER_DELAY_MS=1500
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser JavaScript.

## Local setup

```bash
cd collector
npm install
npx playwright install chromium
```

Unit tests do not make live Naver requests and do not require Chromium.

```bash
npm test
npm run check
```

## One-shot smoke check

Run manually when live network access is acceptable:

```bash
node collector/src/cli.mjs once --keyword "경성대맛집" --mid "1340244014"
```

A successful measurement exits 0 with either `FOUND` or `OUT_OF_RANGE`. `BLOCKED`, `TIMEOUT`, and `FAILED` exit 2. A current rank is never hard-coded.

## Queue worker

Run the worker on a long-running VM/container or equivalent process host:

```bash
node collector/src/cli.mjs worker
```

Do not run the long-lived collector as a Vercel Function. Vercel remains appropriate for the lightweight Python enqueue/analysis endpoints; Chromium collection belongs on a persistent worker host.

The worker claims one `PENDING` job at a time using an atomic Postgres RPC with `FOR UPDATE SKIP LOCKED`, then marks it `RUNNING` before collection. Default concurrency is intentionally 1.

## Status meanings

| Status | UI meaning | History behavior |
|---|---|---|
| `PENDING` | 조회 대기 | none |
| `RUNNING` | 조회 중 | none |
| `SUCCESS` | 정상 완료 | `FOUND` rank 1..300 is stored |
| `OUT_OF_RANGE` | `300+` / 상위 300위 밖 | `rank=null` is stored |
| `BLOCKED` | 조회 제한 | existing successful history is preserved |
| `TIMEOUT` | 조회 지연 | existing successful history is preserved |
| `FAILED` | 조회 실패 | existing successful history is preserved |

`301`, `999` or other sentinel ranks must never be stored.

## No-bypass rule

If Naver returns HTTP 429, captcha/block content, or another access restriction, stop the job and record `BLOCKED`. This project does not implement captcha bypass, proxy rotation, session theft, browser fingerprint evasion, or other block circumvention.

## Initial rollout scale

Increase load only after verifying data quality and failure rates at each step:

```text
15 slots -> 100 slots -> 500 slots -> review before further expansion
```

Keep worker concurrency at 1 for v1 and use `RANK_WORKER_DELAY_MS` to control request pacing.

## Enqueue API

`POST /api/rank_request`

```json
{
  "keyword": "경성대맛집",
  "targetPlaceId": "1340244014",
  "placeName": "태봉곱창 부경대 본점"
}
```

Accepted response:

```json
{
  "slotId": "<uuid>",
  "jobId": "<uuid>",
  "status": "PENDING"
}
```

The endpoint only queues work. It does not wait for a Naver browser collection to finish.
