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

## Phase 1 수집 프레임워크 (2026-11-07)
- `src/collector/`: `SourceAdapter` 인터페이스, 표준데이터 정규화(`standard-parking.ts`), 중복 후보(`dedupe.ts`), 실행기(`runner.ts`), 픽스처 어댑터. `npm run sync -- --fixture <json>`.
- 흐름: 수집 → `source_raw_records` 원문 보존(해시로 변경 이력) → 정규화 → `parking_lots`/`fee_rules`/`operating_schedules` 저장 → 중복 후보 기록(자동 병합 없음) → `source_sync_logs`(PARTIAL/FAILED, 오류 요약에 내부 상세 미포함).
- 행 단위 오류 격리, 재실행 멱등(해시 동일 시 unchanged), 범위 제외(민영·부설)로 바뀐 기존 시설은 `EXCLUDED_SCOPE`로 표시해 검색에서 제외. 원천에서 사라진 시설은 삭제하지 않음(후속: 미수신 처리 정책).
- 픽스처 `tests/fixtures/standard-parking.sample.json`: 포털 공개 샘플 2행 + 합성 경계 케이스 10행(`SYN-*`). 출처명 `STANDARD_SAMPLE`은 UI에서 "샘플(검증 전)"으로 표시(`isMock`).
- 정기권(`SEASON_PASS`)은 시간제 요금 계산을 막지 않도록 변경. 1일권은 기준 UNKNOWN → 계산 불가.
- **실제 원천 어댑터 미구현**: OpenAPI 규격·인증·제한·라이선스 미검증(OPEN_ISSUES 결정 기록 참조). API 키 필요.

## 공휴일 원천 검토·동기화 (2026-11-07)
- 원천 조사 결과는 `OPEN_ISSUES.md` #4 결정 기록 참조(한국천문연구원 특일 정보 API 1차 원천, 법령 대조 근거).
- `src/collector/holidays.ts`: 응답 파서(JSON/XML, 게이트웨이 오류 포함), HTTP 클라이언트(키는 환경변수, 오류에 URL·키 미포함), `syncHolidays`(연도 canary·연속 커버리지·만료·실패 시 기존 유지). `npm run sync:holidays`(`DATA_GO_KR_SERVICE_KEY` 필요).
- 마이그레이션 0003: `holidays` PK를 (date, source, seq)로 재구성(같은 날 겹침, 분류코드 보존).
- `loadHolidays`: 커버리지 + 7일 신선도 확인 시에만 공휴일 판정 가능, 아니면 null(요일별 규칙 시설 요금 계산 불가).
- **미검증**: 공휴일 오퍼레이션 실응답. 테스트는 공식 응답 표 기반 합성 데이터. 키로 실호출 후 대조 필요.
- 결정 대기: 원천의 '공휴일' 규칙을 일요일에 적용할지(일요일 운영·요금 판정).

## 네이버 지도 연동·404 수정 (2026-11-07)
- 공식 문서 검증 결과는 `OPEN_ISSUES.md` #9 결정 기록 참조. `buildNaverLinks`(순수 함수, 문서 예제 형식·URL 인코딩·좌표 범위 검증)와 `MapLinks`(플랫폼별 호출·대체 흐름).
- 검색 결과 → 상세로 목적지(좌표·이름)를 전달해 "주차 후 목적지까지 도보" 링크 생성.
- Playwright로 Pixel 7/iPhone 14/데스크톱 UA에서 렌더 확인(Android=intent 앵커, iOS=버튼, 데스크톱=비활성+복사). **실제 앱 호출은 실기기 미검증.**
- 404 수정: 루트 `loading.tsx` 때문에 스트리밍되어 없는 주차장이 HTTP 200으로 응답 → `loading.tsx`를 `/search` 세그먼트로 이동해 `/lots/{없는 id}`가 404 반환.

## 추천 사유 (2026-11-07)
- `src/domain/recommend.ts`: 정렬 결과를 바꾸지 않고 시설별 장점(`highlights`)·유의점(`cautions`)을 규칙 기반으로 설명. API 응답 `items[].explanation`, 카드에 칩으로 표시(스크린리더용 "장점/유의" 접두).
- 원칙: 요금 정보 없음은 '가격 비교 제외'로 명시하되 감점 없음, 실시간 미제공은 사유 없음, '최저'는 요금 계산 가능한 유료 시설이 2곳 이상일 때만, '가장 가까움'은 2곳 이상일 때만, '최적/1위' 같은 단정 표현 금지(테스트).
- 거리 유의점 임계값 `FAR_METERS=700m`(직선거리, **임시값**): 무료라도 멀면 거리 유의점을 함께 표시(SEARCH_SPEC: 먼 시설을 무조건 최적으로 단정하지 않음).
- 혼잡·여유 표기는 임계값(OPEN_ISSUES #8) 확정 전 임시 설정값 기준.

## 데이터 품질 리포트·접근성 점검 (2026-11-08)
- ADMIN_DATA.md에 따라 관리자 화면 대신 읽기 전용 CLI `npm run quality`(`src/server/quality.ts`): 원천별 시설 수·제외 수·마지막 수집·마지막 성공·기준일 지난 시설, 품질 플래그 집계, 좌표/면수/요금/운영시간 보유 현황, 기준 기간(다음 날 10~12시 KST) 요금 계산 가능 비율과 불가 사유, 공휴일 커버리지 나이, 중복 후보 대기 건수.
- 운영 알림(임계값은 **임시값**, `QUALITY_THRESHOLDS`): `SYNC_FAILED`, `SYNC_STALE`(3일), `RECORDS_DROP`(30%↓), `STALE_LOTS`, `AUTH_FAILURE`/`QUOTA_EXCEEDED`(공공데이터포털 오류코드 20·30·31 / 22·23), `HOLIDAY_COVERAGE_MISSING/EXPIRED`, `COORD_QUALITY`(5%↑), `FEE_UNKNOWN_HIGH`, `DUPLICATES_PENDING`. 목업/샘플 원천은 운영 경보 대상에서 제외하고 `NON_PRODUCTION_SOURCE`로 표시. ERROR 수준 알림이 있으면 종료 코드 1(스케줄러 연동용).
- 접근성: `npm run a11y`(`scripts/a11y.mjs`, axe-core WCAG 2.1 A/AA). 홈·검색 결과·빈 결과·입력 오류·상세 2종·404 × 모바일 390px/데스크톱 1280px = **위반 0건**. 대조 실험(alt 없는 이미지·라벨 없는 입력·저대비)으로 점검 동작 확인. playwright는 프로젝트 의존성이 아니라 CI 미포함. **자동 점검만 수행 — 스크린리더·키보드 수동 점검은 미실시.**
- 운영 알림 전달 채널(메일·메신저)과 스케줄러 연동은 미구현(OPEN_ISSUES #10 인프라 결정 후).

## 미구현·후속
- 운영시간 판정, 시간대별 요금 차등, 단가 혼합 구간, 정기권, 회차 시간: 엔진 미지원(근거 있는 원천 규칙 확인 후 추가).
- 공휴일 원천(OPEN_ISSUES #4) 미정: 현재 holidays 테이블만 있음.

## 다음 단계 (Phase 1)
1. (완료) D8 기술 스택 확정.
2. 공공데이터포털 전국주차장정보표준데이터 샘플 호출 → 공영 여부/노상·노외/좌표/요금/운영시간 필드 커버리지 분석(OPEN_ISSUES #1). API 키 필요.
3. D1~D4 반영한 스키마 확정 후 정규화·원천 보존·수집 로그 구현.
