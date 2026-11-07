# 개발 로그

## Phase 0 — 저장소·환경 파악 (2026-11-07)
- 저장소 `remnant1981`은 Flask 봇/티스토리 자동발행/쿠폰 앱/`govbiz-finder` 등 **무관한 기존 프로젝트의 모음**. 기존 파일 무변경, `parking-save/` 하위에 독립 구성 (`govbiz-finder`와 동일 방식).
- 기존 워크플로: `pages.yml`(coupon-wallet 한정), `tistory-autopost.yml`, `govbiz-ci.yml`(경로 한정). ParkingSave용 CI는 코드 생성 시 `parking-save/**` 경로 한정으로 추가 예정.
- 환경: Node v22.23.4, Python 3.13. 패키지 매니저/런타임은 D8 결정 전까지 미확정.
- 설계 문서 19종(`CLAUDE.md`, `README.md`, `docs/*`) 반입. 문서 간 충돌·공백은 `docs/OPEN_ISSUES.md` D1~D8에 기록.
- 구현 코드 없음. 외부 API(공공데이터포털, 한국교통안전공단, 지자체, 네이버 지도) **미검증** — 임의 확정 금지.

## 다음 단계 (Phase 1)
1. D8 기술 스택 확정(사용자 결정 필요).
2. 공공데이터포털 전국주차장정보표준데이터 샘플 호출 → 공영 여부/노상·노외/좌표/요금/운영시간 필드 커버리지 분석(OPEN_ISSUES #1). API 키 필요.
3. D1~D4 반영한 스키마 확정 후 정규화·원천 보존·수집 로그 구현.
