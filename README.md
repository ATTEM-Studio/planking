# PLANKING

**PLANKING**은 네이버 플레이스 검색 결과의 실제 노출 순위와 실험적 경쟁 지표를 함께 보여주는 경량 분석 대시보드입니다.

> N1/N2/N3와 이를 변환한 100점 지표는 네이버 공식 점수가 아닙니다. 현재 확보한 ADLOG/네이버 샘플을 바탕으로 만든 역공학 기반 비교 지표입니다.

## 핵심 지표

- **현재 순위**: 전달받은 검색 결과 배열의 실제 순서 (`index + 1`)
- **키워드 관련성**: N1의 동일 검색 결과 내 상대 백분위
- **업체 경쟁력**: N2의 동일 검색 결과 내 상대 백분위
- **지역 적합성**: 지역형 검색에서 검색어의 지역 엔티티 경계와 업체 위치의 적합도
- **종합 경쟁점수**: N3의 동일 검색 결과 내 상대 백분위
- **점검 우선 영역**: 비교군에서 상대적으로 낮은 세부 지표
- **경쟁업체 비교**: 같은 키워드 상위 업체와 나란히 비교

## 해석 원칙

PLANKING은 실제 순위와 분석 점수를 분리합니다.

- 실제 순위는 검색 결과 배열에서 직접 읽습니다.
- 분석 점수는 동일 키워드 경쟁업체 사이의 상대점수입니다.
- 낮은 점수를 순위 하락의 직접 원인이라고 단정하지 않습니다.
- 지역형 키워드는 사용자 GPS가 아니라 검색어가 지정한 지역 엔티티를 기준으로 지역 적합성을 계산합니다.
- 관측 N1/N2가 없는 신규 업체는 `fallback_proxy`로 표시하고 신뢰도를 낮춥니다.

## 현재 보정 범위

현재 calibration에는 `하단맛집`, `하단삼겹살`, `하단회식`, `하단고기집` 관측 데이터가 포함되어 있습니다. 새로운 키워드와 신규 업체는 공개 Place 데이터 기반 저신뢰도 fallback을 사용합니다.

## 구조

```text
index.html / styles.css / web/
        ↓
POST /api/analyze
        ↓
calibration.json + N123Engine
        ↓
실제 순위 + 관련성 + 경쟁력 + 지역 적합성 + 종합점수
```

PLANKING 런타임은 Vercel 배포를 쉽게 하기 위해 **Python 표준 라이브러리만 사용**합니다. 초기 실험에 사용했던 scikit-learn/joblib/GIS binary dependency는 런타임에서 제거했습니다.

## API

```json
POST /api/analyze
{
  "query": "하단삼겹살",
  "targetPlaceId": "1800550902",
  "items": ["네이버 Place item 객체 최대 70개"]
}
```

이미 N1/N2/N3가 계산된 경우 `scoredRows`를 전달할 수도 있습니다.

## 로컬 검증

```bash
python -m pytest -q
node --test tests-js/*.test.mjs
python -m compileall -q api src
node --check web/app.mjs
```

## Vercel 배포

저장소 루트를 그대로 Import합니다.

- Framework Preset: Other
- Build Command: 비움
- Output Directory: 비움
- 외부 Python dependency: 없음

현재 MVP는 네이버 서버에 직접 실시간 요청하지 않습니다. 수집기와 분석 엔진은 분리되어 있으며, 실시간 순위 수집은 다음 단계에서 별도 모듈로 연결합니다.

## 버전

`planking-runtime-0.1.0`
