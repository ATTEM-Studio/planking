# Rank Collector v1 Design Spec

## Goal

PLANKING에 네이버 플레이스 실시간 순위 수집 서브시스템을 추가한다. 입력은 `keyword + targetPlaceId(MID)`이며, 비로그인 데스크톱 기준 네이버 지도 검색 결과에서 최대 300위까지 탐색해 실제 오가닉 순위를 기록한다. 300위까지 정상 탐색했으나 MID를 찾지 못한 경우 화면 의미는 `300+`이며, 조회 실패와 절대 같은 상태로 취급하지 않는다.

## Why this is separate from the current analysis runtime

현재 PLANKING의 `/api/analyze`는 전달받은 검색결과 배열을 분석하는 경량 Vercel API이며, 실시간 네이버 수집은 의도적으로 포함하지 않았다. 수집기는 Chromium이 필요하고 실행 시간이 길 수 있으므로 Vercel 분석 런타임과 분리된 worker로 운영한다.

## Scope

### Included in v1

- `keyword + targetPlaceId` 기반 단건 순위 수집
- 최대 6페이지 / 300위 탐색
- 1페이지 `/p/api/search/allSearch` 응답 수집
- 2~6페이지 `pcmap-api.place.naver.com/graphql` 응답 수집
- MID 기준 정확 매칭
- 광고/프로모션 결과를 오가닉 순위 계산에서 제외할 수 있는 명시적 normalizer
- `FOUND`, `OUT_OF_RANGE`, `BLOCKED`, `TIMEOUT`, `FAILED` 상태 구분
- `rank_jobs` 큐와 `rank_history` 일별 기록
- 같은 슬롯/날짜 재조회는 UPSERT
- 백그라운드 worker 순차 처리
- 차단/캡차 감지 시 우회하지 않고 `BLOCKED` 처리
- 기존 PLANKING 분석 API와 수집기를 독립 유지

### Excluded from v1

- 플레이스명만으로 MID 자동 확정
- N1/N2/N3 의미/공식 변경
- 저장수/블로그/방문자리뷰 수집
- 검색량/경쟁업체 수 수집
- 대량 병렬 worker 확장
- 프록시 회전, 캡차 우회, 브라우저 지문 회피
- 모바일/로그인 사용자 개인화 순위

## Measurement contract

v1 순위는 다음 기준으로 정의한다.

- Search surface: Naver Map
- Session: logged out
- Device: desktop Chromium
- Ads: excluded from organic rank
- Limit: top 300
- Target identity: exact MID string match
- Success with target: `FOUND` and integer rank 1..300
- Success without target after complete traversal: `OUT_OF_RANGE`, `rank = null`, UI label `300+`
- Incomplete traversal because of block/timeout/error: never convert to `300+`

## Architecture

```text
PLANKING / caller
      |
      | enqueue(keyword, targetPlaceId, slotId)
      v
rank_jobs (Supabase/Postgres)
      |
      | claim oldest PENDING
      v
Node worker + Playwright Chromium
      |
      | open Naver Map search
      | capture network responses
      v
NaverMapCollector
      |
      | normalize items / remove ads
      | match MID
      v
RankResult
      |
      +--> rank_history UPSERT
      +--> rank_jobs status update
```

## Data model

### `rank_slots`

- `id uuid primary key`
- `keyword text not null`
- `target_mid text not null`
- `place_name text null`
- `active boolean not null default true`
- `created_at timestamptz not null default now()`
- unique `(keyword, target_mid)`

### `rank_jobs`

- `id uuid primary key`
- `slot_id uuid not null references rank_slots(id)`
- `status text not null` in `PENDING|RUNNING|SUCCESS|OUT_OF_RANGE|BLOCKED|TIMEOUT|FAILED`
- `requested_at timestamptz not null default now()`
- `started_at timestamptz null`
- `finished_at timestamptz null`
- `attempt_count int not null default 0`
- `error_code text null`
- `error_message text null`

### `rank_history`

- `id uuid primary key`
- `slot_id uuid not null references rank_slots(id)`
- `measured_date date not null`
- `rank int null check (rank between 1 and 300)`
- `status text not null`
- `pages_scanned int not null default 0`
- `items_scanned int not null default 0`
- `measured_at timestamptz not null default now()`
- unique `(slot_id, measured_date)`

`OUT_OF_RANGE`는 `rank = null`로 저장한다. `301`, `999` 같은 가짜 순위 값은 사용하지 않는다.

## Collector interface

```ts
export type RankStatus =
  | 'FOUND'
  | 'OUT_OF_RANGE'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'FAILED';

export interface RankQuery {
  keyword: string;
  targetMid: string;
  maxRank?: number; // default 300
}

export interface RankResult {
  status: RankStatus;
  rank: number | null;
  pagesScanned: number;
  itemsScanned: number;
  matchedMid: string | null;
  errorCode?: string;
  errorMessage?: string;
}

export interface RankCollector {
  collect(query: RankQuery): Promise<RankResult>;
}
```

## Naver response handling

1. `https://map.naver.com/p/search/<keyword>`를 연다.
2. Playwright `page.on('response')`로 네트워크 응답을 관찰한다.
3. 첫 페이지는 URL에 `/p/api/search/allSearch`가 포함된 JSON에서 place list를 찾는다.
4. 2페이지부터는 `iframe#searchIframe`의 페이지 버튼을 실제로 전환하며 `https://pcmap-api.place.naver.com/graphql` 응답에서 `items` 배열을 재귀적으로 찾는다.
5. 각 페이지를 정규화한 뒤 프로모션/광고 항목을 제거하고 오가닉 순서를 유지한다.
6. 각 normalized item의 `id` 또는 `placeId`를 문자열로 변환해 `targetMid`와 정확 비교한다.
7. 발견 시 즉시 `FOUND` 반환한다.
8. 300위까지 정상 탐색 완료 시 `OUT_OF_RANGE` 반환한다.
9. 네이버 제한/캡차/429/비정상 차단 페이지를 감지하면 `BLOCKED`로 종료한다. 우회 로직은 넣지 않는다.

## Queue semantics

- 수동 재조회와 일일 스케줄 모두 `rank_jobs`에 `PENDING` 작업을 추가한다.
- worker는 한 번에 하나의 작업을 claim하여 `RUNNING`으로 바꾼 뒤 처리한다.
- v1 기본 동시성은 1이다.
- 완료 결과는 `rank_history`에 KST 기준 날짜로 UPSERT한다.
- 동일 슬롯의 같은 날짜 재조회는 기존 행을 갱신한다.
- `BLOCKED`, `TIMEOUT`, `FAILED`는 기존 성공 순위를 지우지 않고 해당 재조회 결과 상태를 기록할 수 있도록 job 로그에 남긴다. `rank_history`의 당일 값 갱신은 성공(`FOUND|OUT_OF_RANGE`)일 때만 수행한다.

## Dashboard semantics

- `FOUND, rank=19` -> `19위`
- `OUT_OF_RANGE` -> `300+` / 보조문구 `상위 300위 밖`
- `PENDING` -> `조회 대기`
- `RUNNING` -> `조회 중`
- `BLOCKED` -> `조회 제한`
- `TIMEOUT` -> `조회 지연`
- `FAILED` -> `조회 실패`

실패 상태를 `300+`로 표현하지 않는다.

## Safety and operational constraints

- 캡차 우회, 세션 탈취, 프록시 회전, 차단 회피 기능을 구현하지 않는다.
- 요청 빈도는 환경변수로 제한하고 worker 기본 동시성은 1로 둔다.
- 응답 스키마가 바뀌면 `FAILED/PARSE_ERROR`로 명확히 남기고 기존 순위를 훼손하지 않는다.
- Vercel 분석 런타임은 현재의 Python 표준 라이브러리 제약을 유지한다.
- Playwright 의존성은 `collector/` 서브프로젝트에만 둔다.

## Acceptance criteria

1. fixture 기반으로 1페이지 MID 발견 시 정확한 순위를 반환한다.
2. 2~6페이지 fixture에서도 누적 오가닉 순위를 정확히 계산한다.
3. 광고 항목은 순위 카운트에서 제외된다.
4. 300위까지 완료 후 미발견이면 `OUT_OF_RANGE/rank=null`을 반환한다.
5. 중간 timeout/block은 `OUT_OF_RANGE`로 변환되지 않는다.
6. worker가 `PENDING -> RUNNING -> terminal status`로 상태를 전이한다.
7. 성공한 재조회는 `(slot_id, measured_date)` 기준 UPSERT된다.
8. 기존 Python 분석 테스트는 모두 통과한다.
9. collector Node 테스트도 모두 통과한다.
