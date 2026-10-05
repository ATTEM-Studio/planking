# PLANKING 전면 재설계 디자인

작성일: 2026-10-06
대상 저장소: `ATTEM-Studio/planking`

## 1. 목표

PLANKING을 기존의 실험적 네이버 플레이스 분석 대시보드에서, 그리온이 실제 클라이언트 운영에 사용할 수 있는 **네이버 플레이스 순위 추적 서비스**로 전면 재설계한다.

첫 운영 대상은 그리온 내부 관리자/직원과 그리온 클라이언트다. 다만 데이터 모델과 권한 구조는 향후 외부 마케팅 대행사나 사업자가 직접 가입하는 SaaS로 확장할 수 있게 설계한다.

핵심 성공 기준은 다음과 같다.

- 네이버 Place ID 기준으로 매장을 정확히 식별한다.
- 업체별 여러 키워드의 자연 노출 순위를 반복 측정하고 히스토리를 축적한다.
- 광고 노출과 자연 노출을 구분한다.
- 순위 밖과 수집 실패를 반드시 구분한다.
- 하루 2회 자동 수집과 제한된 수동 조회를 제공한다.
- 클라이언트는 자신에게 허용된 업체만 조회할 수 있다.
- 임의의 비공식 SEO 점수를 핵심 지표로 사용하지 않는다.

## 2. 현재 구조와 개편 원칙

현재 저장소는 정적 웹 UI, Python API, Node/Playwright collector, Supabase 작업 큐, 실험적 N1/N2/N3 분석 로직이 혼재한다. 최근 운영 코드는 Vercel 내부 즉시 수집과 별도 worker 수집을 함께 유지하면서 복잡도가 커졌다.

이번 개편은 다음 원칙으로 진행한다.

### 제거 또는 폐기

- N1/N2/N3 기반 실험 점수 및 calibration 중심 UI
- 분석 점수를 공식 순위 요인처럼 오해할 수 있는 화면
- 기존 정적 단일 페이지 UI
- Vercel serverless 안에서 Chromium을 직접 실행하는 즉시 수집 경로
- 중복된 rank request/status/manage 계층
- 기존 실험용 smoke/diagnostic workflow 중 새 구조와 무관한 항목

### 재사용 및 리팩터링

- `collector/src/naver-map-collector.mjs`의 네이버 결과 수집 로직
- Place ID 기반 매칭 아이디어
- 광고 제외 자연 순위 계산 로직
- 차단/타임아웃/파싱 실패 상태 구분
- Supabase 작업 큐 패턴
- 기존 collector 테스트 fixture와 회귀 테스트 중 유효한 부분

재사용 코드는 새 인터페이스에 맞춰 분리하며, 기존 파일을 그대로 장기 유지하는 것을 목표로 하지 않는다.

## 3. 제품 범위

### 3.1 관리자

그리온 관리자는 다음을 할 수 있다.

- 클라이언트 생성/수정/비활성화
- 업체 등록 및 Place ID 연결
- 업체별 추적 키워드 추가/삭제/활성화
- 전체 업체 순위 현황 조회
- 수동 순위 수집 요청
- 수집 실패 상태 확인
- 클라이언트 사용자 초대 및 접근 업체 지정

### 3.2 직원

직원은 권한이 부여된 조직 내 업체를 관리하고 조회할 수 있다. 결제/조직 소유권 등 향후 SaaS 관리 기능은 첫 버전에 포함하지 않는다.

### 3.3 클라이언트

클라이언트는 자신에게 허용된 업체만 조회한다.

- 현재 순위
- 전일 대비 변화
- 7일/30일 변화
- TOP 3 / TOP 10 / TOP 20 키워드 수
- 상승/하락 키워드
- 키워드별 순위 그래프
- 최근 정상 수집 시각
- 수집 실패 또는 데이터 없음 상태

클라이언트는 기본적으로 업체/키워드 설정을 수정할 수 없다.

## 4. 아키텍처

```text
Browser
  ↓
Next.js Web App (Vercel)
  ├─ Auth / Dashboard / Admin UI
  ├─ Server Actions / Route Handlers
  └─ Read API
        ↓
Supabase
  ├─ Auth
  ├─ Postgres
  ├─ Row Level Security
  └─ Rank Job Queue
        ↑
Rank Collector Worker
  ├─ Playwright Chromium
  ├─ Naver Place/Search collection
  ├─ Place ID exact matching
  └─ Result/status persistence
        ↑
Scheduler
  └─ 하루 2회 자동 enqueue
```

### 배포 경계

- Vercel: Next.js UI와 짧은 API 요청만 담당한다.
- Supabase: 인증, 권한, 데이터, 작업 큐를 담당한다.
- Collector: Chromium이 필요한 장기 실행 수집을 담당하며 Vercel Function과 분리한다.
- Scheduler: 하루 2회 대상 키워드 작업을 생성한다.

Vercel 내부 Chromium 수집은 새 버전에서 사용하지 않는다.

## 5. 저장소 구조

기존 저장소를 다음 구조로 재편한다.

```text
planking/
  apps/
    web/                    # Next.js App Router
  packages/
    core/                   # 순위 상태, 도메인 타입, 공통 로직
    db/                     # Supabase 타입/쿼리/권한 헬퍼
  workers/
    rank-collector/         # Playwright worker
  supabase/
    migrations/             # 스키마/RLS/RPC
    seed.sql
  docs/
    architecture/
    operations/
    superpowers/specs/
  .github/workflows/
  package.json
  README.md
```

모노레포 도구는 첫 버전에서 과도하게 복잡한 프레임워크를 추가하지 않는다. npm workspaces를 기본으로 사용한다.

## 6. 데이터 모델

### organizations

- `id`
- `name`
- `slug`
- `status`
- `created_at`

현재는 그리온 조직 하나로 시작하지만 SaaS 확장을 위해 조직 경계를 둔다.

### profiles

Supabase Auth 사용자와 1:1 연결한다.

- `id` = auth.users.id
- `display_name`
- `created_at`

### organization_members

- `organization_id`
- `user_id`
- `role`: `owner | admin | staff | client`

### clients

- `id`
- `organization_id`
- `name`
- `status`
- `created_at`

### places

- `id`
- `client_id`
- `naver_place_id`
- `name`
- `place_url`
- `address`
- `category`
- `status`
- `created_at`

`naver_place_id`는 중복 매장 오인 방지를 위한 핵심 식별자다.

### keywords

- `id`
- `place_id`
- `keyword`
- `is_active`
- `max_rank` 기본 100
- `created_at`

### client_place_access

클라이언트 사용자가 접근 가능한 업체를 명시한다.

- `user_id`
- `place_id`
- `can_view`

### collection_jobs

- `id`
- `keyword_id`
- `trigger`: `scheduled | manual | retry`
- `status`: `PENDING | RUNNING | SUCCEEDED | OUT_OF_RANGE | BLOCKED | TIMEOUT | PARSE_ERROR | FAILED`
- `attempt_count`
- `requested_by`
- `created_at`
- `started_at`
- `finished_at`
- `error_code`
- `error_message`

### rank_snapshots

한 번의 정상 관측 결과를 보존한다.

- `id`
- `keyword_id`
- `rank` nullable
- `status`: `FOUND | OUT_OF_RANGE`
- `max_rank`
- `items_scanned`
- `pages_scanned`
- `measured_at`
- `collector_version`

`BLOCKED`, `TIMEOUT`, `PARSE_ERROR` 등 수집 실패는 순위값으로 저장하지 않는다. 실패 정보는 `collection_jobs`에 남긴다. 따라서 `300+`와 장애가 혼동되지 않는다.

### place_metric_snapshots

첫 버전에서는 선택적으로 방문자 리뷰 수, 블로그 리뷰 수, 저장 수 등 안정적으로 수집 가능한 값만 저장한다. 순위 기능 완성보다 우선하지 않는다.

## 7. 순위 정의와 수집 규칙

### 기준

- 타깃 매장은 `naver_place_id`로 판별한다.
- 기본 최대 탐색 범위는 TOP 100이다.
- 업체 또는 키워드별로 최대 TOP 300까지 설정 가능하게 데이터 구조만 지원한다.
- 광고는 자연 순위에서 제외한다.
- 동일 조건 비교를 위해 서버 지역, 브라우저 locale, viewport, user agent를 고정한다.
- 위치 개인화 영향을 완전히 제거할 수 있다고 주장하지 않는다.

### 결과 상태

- `FOUND`: 지정 범위 내에서 Place ID 발견
- `OUT_OF_RANGE`: 수집은 정상 완료했으나 지정 범위 내 미발견
- `BLOCKED`: 캡차/차단 징후
- `TIMEOUT`: 제한 시간 초과
- `PARSE_ERROR`: 네이버 구조 변경 등으로 결과 파싱 실패
- `FAILED`: 분류되지 않은 실행 오류

순위 차트에는 `FOUND`와 `OUT_OF_RANGE`만 데이터 상태로 사용한다. 실패는 별도 운영 경고로 표시한다.

## 8. 수집 스케줄과 수동 조회

### 자동 수집

기본 하루 2회 실행한다.

- 오전 수집
- 저녁 수집

구체적인 시각은 배포 환경에서 변경 가능한 설정값으로 둔다.

### 수동 조회

- 관리자/직원만 기본 허용
- 동일 키워드에 쿨다운 적용
- 이미 `PENDING` 또는 `RUNNING` 작업이 있으면 중복 작업을 생성하지 않음
- 수동 요청도 동일 worker queue를 사용

클라이언트의 직접 수동 조회 권한은 첫 버전에서 제외한다.

## 9. 화면 구조

### 로그인

- 이메일 기반 로그인
- SaaS 결제/회원가입 랜딩은 첫 버전 제외

### 전체 대시보드

- 전체 업체 수
- 추적 키워드 수
- 오늘 상승/하락 키워드 수
- 정상 수집률
- 업체 카드 목록
- 최근 수집 실패 경고

### 업체 상세

상단 요약:

- 업체명
- Place ID
- 마지막 정상 수집 시각
- 평균 순위
- TOP 3 / TOP 10 / TOP 20 키워드 수

본문:

- 키워드 테이블
- 현재 순위
- 직전 대비
- 7일 변화
- 30일 변화
- 상태
- 선택 키워드 순위 차트

### 관리자 화면

- 클라이언트 관리
- 업체 관리
- 키워드 관리
- 사용자/접근 권한
- 수집 작업 상태

## 10. UI 원칙

- 기존 실험 분석 화면은 폐기한다.
- Toss 계열의 정보 밀도와 명확한 계층을 참고하되 브랜드 카피보다 데이터 가독성을 우선한다.
- 데스크톱에서 업무용 대시보드로 가장 효율적이어야 하며 모바일에서도 조회 가능해야 한다.
- 순위 상승은 좋은 변화, 하락은 나쁜 변화라는 의미를 직관적으로 전달하되 색상만으로 상태를 구분하지 않는다.
- 데이터가 없는 경우, 순위 밖인 경우, 수집 실패인 경우를 서로 다른 메시지로 표현한다.

## 11. API와 도메인 경계

웹 UI가 collector 내부 구현에 직접 의존하지 않도록 한다.

### Web → DB

웹은 Supabase를 통해 설정과 히스토리를 읽고, 서버 측 액션으로 작업을 enqueue한다.

### Worker → DB

Worker는 `collection_jobs`를 claim하고 collector 엔진을 실행한 뒤 결과를 저장한다.

### Collector Engine

Collector 엔진 입력:

```ts
{
  keyword: string;
  targetPlaceId: string;
  maxRank: number;
}
```

출력:

```ts
{
  status: 'FOUND' | 'OUT_OF_RANGE' | 'BLOCKED' | 'TIMEOUT' | 'PARSE_ERROR' | 'FAILED';
  rank: number | null;
  itemsScanned: number;
  pagesScanned: number;
  errorCode?: string;
  errorMessage?: string;
}
```

이 계약을 기준으로 네이버 수집 방식이 바뀌어도 웹/DB 계층을 수정하지 않게 한다.

## 12. 권한과 보안

Supabase RLS를 필수로 사용한다.

- owner/admin: 조직 전체 접근
- staff: 조직 내 운영 데이터 접근
- client: `client_place_access`에 허용된 place만 조회
- service role: worker 전용

브라우저에 service role key를 노출하지 않는다.

관리자용 변경 작업은 서버 측에서 권한을 재검증한다.

## 13. 오류 처리와 운영성

- Collector 오류는 사용자에게 가짜 순위로 표시하지 않는다.
- 연속 실패 키워드는 관리자 대시보드에 경고한다.
- 구조 변경 감지를 위해 파싱 fixture 기반 회귀 테스트를 유지한다.
- 작업에는 collector version을 남겨 변경 전후 결과를 추적할 수 있게 한다.
- stale RUNNING job을 재큐잉할 수 있는 복구 RPC를 둔다.
- 로그에 비밀번호, Supabase service role key 등 비밀값을 남기지 않는다.

## 14. 테스트 전략

### Core 단위 테스트

- 순위 변화 계산
- TOP N 집계
- 상태 변환
- OUT_OF_RANGE 처리

### Collector 테스트

- Place ID 정확 매칭
- 광고 제외
- 정상 순위
- 범위 밖
- 차단 HTML
- timeout
- 파싱 실패
- 중복/페이지네이션

현재 collector fixture 중 유효한 케이스는 새 worker 테스트로 이전한다.

### DB/RLS 테스트

- client가 타 업체를 읽을 수 없음
- staff/admin 권한 확인
- 중복 collection job 방지
- stale job 복구

### Web E2E

- 로그인
- 업체 목록
- 업체 상세
- 키워드 추가
- 수동 조회 enqueue
- 실패 상태 표시

## 15. 마이그레이션 전략

이번 변경은 기존 런타임과의 점진적 호환을 목표로 하지 않는다. 저장소는 유지하지만 제품은 새 버전으로 교체한다.

1. 현재 `main`의 마지막 커밋은 Git 히스토리에 보존한다.
2. 새 구조를 별도 구현 브랜치에서 작성한다.
3. 기존 Supabase 테이블은 바로 삭제하지 않고 새 스키마와 충돌하지 않게 구분한다.
4. 새 앱과 worker 검증이 끝난 후 새 스키마를 운영 기준으로 전환한다.
5. 기존 N1/N2/N3 UI/API와 serverless Chromium 코드를 제거한다.
6. 배포 검증 후 main에 통합한다.

기존 순위 히스토리가 새 모델로 안전하게 매핑 가능한 경우에만 이관한다. 의미가 다른 데이터는 억지로 병합하지 않는다.

## 16. 첫 버전에서 하지 않는 것

- 결제/구독
- 외부 사용자의 셀프 회원가입
- AI 기반 순위 상승 원인 단정
- 비공식 SEO 점수
- 리뷰 감성 분석
- 경쟁사 자동 추천
- 실시간 5분 단위 전체 업체 수집
- 다지역 프록시 기반 위치별 순위

이 기능들은 기본 순위 데이터의 안정성이 검증된 후 별도 단계로 검토한다.

## 17. 완료 기준

다음 조건을 만족하면 전면 개편 1차 버전을 완료한 것으로 본다.

- 관리자 계정으로 업체/키워드를 관리할 수 있다.
- 클라이언트 계정은 허용된 업체만 볼 수 있다.
- 하루 2회 자동 작업이 생성되고 worker가 처리한다.
- 수동 조회가 동일 큐로 처리된다.
- Place ID 기반 TOP 100 순위가 저장된다.
- FOUND/OUT_OF_RANGE/수집 실패가 명확히 분리된다.
- 업체별 30일 순위 그래프와 키워드 표를 볼 수 있다.
- 핵심 collector/권한/E2E 테스트가 통과한다.
- Vercel에서 Chromium을 실행하지 않는다.
