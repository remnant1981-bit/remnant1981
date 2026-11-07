# 개발 로그

## Phase 0 — 저장소·환경 파악 (2026-11-07)
- 저장소 `remnant1981`은 Flask 봇/티스토리 자동발행/쿠폰 앱/`govbiz-finder` 등 **무관한 기존 프로젝트의 모음**. 기존 파일 무변경, `parking-save/` 하위에 독립 구성 (`govbiz-finder`와 동일 방식).
- 기존 워크플로: `pages.yml`(coupon-wallet 한정), `tistory-autopost.yml`, `govbiz-ci.yml`(경로 한정). ParkingSave용 CI는 코드 생성 시 `parking-save/**` 경로 한정으로 추가 예정.
- 환경: Node v22.23.4, Python 3.13. 패키지 매니저/런타임은 D8 결정 전까지 미확정.
- 설계 문서 19종(`CLAUDE.md`, `README.md`, `docs/*`) 반입. 문서 간 충돌·공백은 `docs/OPEN_ISSUES.md` D1~D8에 기록.
- 구현 코드 없음. 외부 API(공공데이터포털, 한국교통안전공단, 지자체, 네이버 지도) **미검증** — 임의 확정 금지.

## 스택 확정 및 골격 (2026-11-07)
- D8 결정: govbiz-finder와 동일(Next.js 16 + TS + Tailwind 4 + node:sqlite + Vitest). CI `.github/workflows/parking-ci.yml`(`parking-save/**` 경로 한정).
- `migrations/0001_init.sql`: DATABASE.md 전 테이블 + D1(holidays)·D2(fee_rules.daily_max_basis)·D3(source_raw_records)·D4(duplicate_candidates) 반영. 값 없음은 NULL 유지.
- 순수 도메인: `src/domain/fee.ts`(요금 엔진), `geo.ts`(haversine), `occupancy.ts`(잔여면수·혼잡도·신선도). 시간 유틸 `src/lib/time.ts`(KST 경계).
- 요금 엔진 정책: 규칙 없음/금액 미확인/충돌/공휴일 데이터 없음/일일최대 기준 불명/시간대별 요금 차등/기간 중 단가 변경은 `UNKNOWN`(계산 불가) 반환. 공휴일에 평일·주말 규칙 대입 안 함. 일일최대는 달력일(KST) 기준만 지원, 단위 올림은 누적 기준.
- 검증: lint 오류 0, typecheck, vitest 31개, build 통과. 홈은 "개발 중" 고지만 표시(실데이터 미연동).

## 미구현·후속
- 운영시간 판정, 시간대별 요금 차등, 단가 혼합 구간, 정기권, 회차 시간: 엔진 미지원(근거 있는 원천 규칙 확인 후 추가).
- 공휴일 원천(OPEN_ISSUES #4) 미정: 현재 holidays 테이블만 있음.

## 다음 단계 (Phase 1)
1. (완료) D8 기술 스택 확정.
2. 공공데이터포털 전국주차장정보표준데이터 샘플 호출 → 공영 여부/노상·노외/좌표/요금/운영시간 필드 커버리지 분석(OPEN_ISSUES #1). API 키 필요.
3. D1~D4 반영한 스키마 확정 후 정규화·원천 보존·수집 로그 구현.
