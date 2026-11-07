# 내부 API 명세 초안

외부 데이터 원천의 실제 명세가 검증되기 전에는 아래 내부 API 계약을 우선 설계한다.

## GET /api/parking-lots
Query:
- `lat`, `lng` 또는 `destination`
- `radiusMeters`
- `startAt`, `endAt` (ISO 8601 with offset)
- `sort`: `free_first` | `price_asc` | `distance_asc` | `availability_desc`
- `type`: `on_street` | `off_street` | `all`

Response:
- `items[]`: facility summary
- `searchCenter`
- `requestedPeriod`
- `dataCoverage`
- `warnings[]`

## GET /api/parking-lots/{id}
시설 상세, 운영 규칙, 요금 규칙, 데이터 출처/갱신시각 반환.

## POST /api/admin/sync
관리자 권한이 있는 경우에만 수집 작업 실행. 인증/인가 필수.

## 공통
- 응답에 요금 계산 상태와 정보 신뢰도를 포함한다.
- 외부 원천 오류는 사용자용 오류와 내부 로그를 분리한다.
- 좌표·시간·금액 단위는 명시한다.
