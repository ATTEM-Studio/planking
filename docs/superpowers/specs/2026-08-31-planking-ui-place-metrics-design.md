# PLANKING UI + 플레이스 지표 리디자인 설계

> 날짜: 2026-08-31
> 상태: 사용자 방향 승인, 구현 전 사양 고정

## 목표

현재 PLANKING 순위 추적 화면을 전달받은 블루 로고 톤에 맞게 전면 정리하고, 모바일에서의 가독성과 상호작용을 강화한다. 기존 순위 카드에는 오늘 기준 1일 / 7일 / 30일 변화량을 추가하고, 플레이스 자체 지표(영수증리뷰 / 블로그리뷰 / 저장)를 날짜별로 저장·비교한다. 카드 클릭 시 상세 팝업에서 순위뿐 아니라 각 플레이스 지표의 변화 그래프도 함께 제공한다.

## 디자인 방향

- 메인 브랜드 컬러는 전달받은 PLANKING 로고의 강한 블루 계열로 통일한다.
- 기존 녹색 중심 디자인은 제거하고 블루 / 화이트 / 뉴트럴 그레이 기반으로 재정의한다.
- 상단에 실제 PLANKING 로고를 배치한다.
- 과한 장식보다 숫자와 상태가 먼저 보이는 대시보드 구조를 유지한다.
- 카드, 버튼, 탭은 모바일 터치 크기를 우선하고, hover 전용 UX를 만들지 않는다.
- 모바일에서는 카드 진입 시 짧은 fade+translate 모션, 버튼 press feedback, 상세 모달은 하단 시트에 가까운 동작으로 구성한다.
- `prefers-reduced-motion`을 존중한다.

## 등록 폼

- `순위 추적 등록`의 모든 예시 placeholder를 제거한다.
- 필드 라벨은 유지한다.
- MID 또는 네이버 URL 입력 안내는 helper 문구로만 제공한다.

## 데이터 모델

기존 `rank_history`는 키워드 × MID × 날짜 순위 기록으로 그대로 유지한다.

신규 `place_metrics_history`를 추가한다.

- `id`
- `target_mid`
- `measured_date` (KST)
- `visitor_review_count` (integer nullable)
- `blog_review_count` (integer nullable)
- `save_count_raw` (text nullable)
- `measured_at`
- unique(`target_mid`, `measured_date`)

플레이스 지표는 키워드별로 중복 저장하지 않고 MID 기준으로 하루 한 번만 보관한다.

## 저장 수 처리 기준

네이버가 `87,000+`, `1,000+`, `~100`처럼 구간형으로 제공하면 **원문 그대로 저장·표시**한다.

- 임의로 `87000`, `1000`, `100` 같은 확정값으로 변환하지 않는다.
- 1일/7일/30일 비교에서도 정확한 숫자 차이를 만들지 않는다.
- 같은 문자열이면 `변동 없음`.
- 문자열이 바뀌면 `87,000+ → 90,000+`처럼 구간 변화로 표시한다.
- 그래프는 구간형 저장 수의 가짜 정밀 수치를 만들지 않는다. 시간축에 raw label 기반 이벤트/스텝 변화로 표현한다.

## 플레이스 지표 수집

현재 Naver `getRestaurants` GraphQL에서 확인한 필드 기준으로 수집한다.

- `visitorReviewCount`
- `blogCafeReviewCount`
- `saveCount`

Collector가 대상 MID를 발견한 시점에 순위와 함께 해당 플레이스 지표를 추출한다.

동일 MID가 여러 키워드 슬롯에서 같은 날 조회되더라도 `place_metrics_history`는 UPSERT한다.

순위 조회 실패 시 플레이스 지표를 임의 기록하지 않는다. 실제 대상 MID가 응답에서 확인되고 지표 필드가 확보된 경우에만 기록한다.

## 카드 UI

각 순위 카드에는 다음 정보를 표시한다.

- 키워드
- 업체명 / MID
- 현재 순위
- 순위 변화
- 최근 측정 시각
- 영수증리뷰 현재값
- 블로그리뷰 현재값
- 저장 현재값(raw)
- 기간 탭: `1일 / 7일 / 30일`
- 선택 기간 대비 순위 변화
- 선택 기간 대비 영수증리뷰 변화량
- 선택 기간 대비 블로그리뷰 변화량
- 선택 기간 대비 저장 구간 변화

기간 비교는 항상 **사용자가 화면을 보는 오늘(KST) 기준**으로 계산한다.

예: 오늘이 2026-08-31이면

- 1일 = 2026-08-30과 비교
- 7일 = 2026-08-24과 비교
- 30일 = 2026-08-01과 비교

정확한 기준 날짜 기록이 없으면 가장 가까운 과거 기록을 몰래 대체하지 않고 `비교 데이터 없음`으로 표시한다.

## 상세 팝업

기존 순위 누적 모달을 확장한다.

상단 요약:
- 현재 순위
- 최고 순위
- 최근 순위 변동
- 누적 기록일

그래프 영역:
- 순위 변화
- 영수증리뷰 변화
- 블로그리뷰 변화
- 저장 변화(raw 구간 기반)

그래프 전환은 탭 방식으로 한다.

기간 탭:
- 7일
- 30일
- 90일
- 전체

모바일에서는 그래프와 요약 카드가 세로 한 열로 흐르고, 모달은 화면 하단에서 올라오는 형태로 보이게 한다.

## API 변경

`/api/rank_status`
- 각 슬롯에 최신 플레이스 지표와 오늘 기준 1일/7일/30일 비교값을 포함한다.

`/api/rank_manage`
- 해당 MID의 플레이스 지표 전체 history를 순위 history와 함께 반환한다.

## 오류 처리

- 순위 `INCOMPLETE/BLOCKED/TIMEOUT/FAILED`는 기존 계약 유지.
- 실패 조회가 기존 정상 순위 또는 플레이스 지표를 덮어쓰지 않는다.
- 지표 일부가 누락돼도 순위 자체는 정상 저장 가능하다.
- 지표가 없는 필드는 `—`로 표시한다.

## 테스트

- migration 보안/RLS 테스트
- Collector의 `visitorReviewCount/blogCafeReviewCount/saveCount` 추출 테스트
- 같은 MID 여러 키워드에서 지표 UPSERT 중복 방지 테스트
- KST 오늘 기준 1/7/30일 비교 테스트
- save raw 문자열 변화 비교 테스트
- 카드 렌더링 유틸 테스트
- 상세 그래프 데이터 변환 테스트
- 모바일 CSS/JS syntax 검증
- 기존 rank collector regression 전체 테스트

## 구현 범위 파일

예상 변경:
- `index.html`
- `styles.css`
- `manage.css`
- `web/app.mjs`
- `web/rank-tracker-utils.mjs`
- `api/rank_status.py`
- `api/rank_manage.py`
- `collector/src/normalize.mjs`
- `collector/src/naver-map-collector.mjs`
- `collector/src/supabase-repository.mjs`
- 신규 Supabase migration
- 테스트 파일
- 브랜드 로고 asset

## 범위 밖

이번 작업에서는 N1/N2/N3 실험지수를 production 카드에 추가하지 않는다. N123 연구 기록은 별도 유지하며 지수 원천/정확도 검증 이후 별도 작업으로 추가한다.
