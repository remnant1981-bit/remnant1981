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

## 목업 기반 검색 API·UI (2026-11-07)
- **실제 원천 미연동 → 목업 모드.** `src/server/mock.ts`: 가상 주차장 8곳(source_name=`MOCK`, 이름 `[목업]`, 화면 상단 배너/카드 라벨/응답 `warnings`·`dataCoverage.isMockData`로 3중 표시). 요금 있음/무료/요금 없음/규칙 불명확/실시간 유효·오래됨·미제공/공영 미확인/면수 NULL 등 상태를 고루 포함. `PARKING_MOCK_DATA=false`로 끔(기본 on — 실데이터 연동 시 기본값 재검토).
- 목적지 검색은 **목업 지오코더**(서울시청·광화문·서울역·을지로입구)만 지원. 실제 지오코딩 미결(D7).
- 공휴일: `holiday_coverage`(마이그레이션 0002)로 "데이터가 완전한 기간"을 명시. 목업은 2026-11~12(공휴일 12/25)만 → 범위 밖은 공휴일 판정 불가로 요일별 규칙 시설은 요금 계산 불가.
- API: `GET /api/parking-lots`(검증·반경 100~5000m 기본 1km·정렬 4종·유형/무료/실시간 필터, `Cache-Control: no-store`), `GET /api/parking-lots/{id}`(규칙·출처·기간 지정 시 요금). 오류는 사용자용 코드/메시지만 응답, 상세는 서버 로그.
- UI: 홈(목적지/현재 위치 버튼[클릭 시에만 권한 요청, 좌표 4자리 축소]/시작·종료/빠른 선택 1·2·3시간/조건), 결과 목록(요금·운영·면수·실시간·출처·기준일, 빈 결과·오류·검증 오류·경고 상태), 상세(요금 규칙표·운영시간·출처·주소/좌표 복사). 모바일 폭(390px) 가로 스크롤 없음 확인.
- 운영 상태: `src/domain/operating.ts`(입·출차 시각 기준, 미기재=확인 불가).
- 정렬: 요금 계산 불가 시설은 가격 순위에서 제외하고 뒤로, 실시간 미제공은 감점 없이 거리순 뒤.
- 미구현: 지도 보기(목록만), 네이버 지도 딥링크(공식 문서 검증 전 — 복사 대체만), 서비스 단 rate limit, 접근성 자동 점검(axe) 미실시.

## 미구현·후속
- 운영시간 판정, 시간대별 요금 차등, 단가 혼합 구간, 정기권, 회차 시간: 엔진 미지원(근거 있는 원천 규칙 확인 후 추가).
- 공휴일 원천(OPEN_ISSUES #4) 미정: 현재 holidays 테이블만 있음.

## 다음 단계 (Phase 1)
1. (완료) D8 기술 스택 확정.
2. 공공데이터포털 전국주차장정보표준데이터 샘플 호출 → 공영 여부/노상·노외/좌표/요금/운영시간 필드 커버리지 분석(OPEN_ISSUES #1). API 키 필요.
3. D1~D4 반영한 스키마 확정 후 정규화·원천 보존·수집 로그 구현.
