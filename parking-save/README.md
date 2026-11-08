# ParkingSave — Claude Code 프로젝트 패키지

이 패키지는 전국 공영주차장 통합 검색·주차비 비교 서비스 **파킹세이브(ParkingSave)**의 기획 및 개발 기준 문서입니다.

## 시작 순서
1. `CLAUDE.md`와 `docs/PRD.md`를 먼저 읽습니다.
2. `docs/OPEN_ISSUES.md`의 미확정 사항을 확인합니다.
3. `docs/DEVELOPMENT_PLAN.md` 순서대로 구현합니다.
4. 외부 API·네이버 지도 연동은 공식 문서와 실제 응답을 검증한 뒤 구현합니다.

## 현재 상태 (2026-11-08)
**목업·샘플 데이터로 동작하는 단계**입니다. 실제 공공데이터는 아직 연동·검증되지 않았습니다(API 키 필요). 화면 상단의 "목업 데이터 안내"와 `[목업]` 표기는 실제 정보가 아님을 뜻합니다.
- 구현됨: 검색·요금 계산·추천 사유·상세(네이버 지도 앱 호출 링크), 수집 어댑터 3종(표준데이터·공휴일·서울 실시간), 데이터 품질 리포트, 관리자 수집 API(인증·감사로그), 요청 제한, CSP
- 미검증/대기: 실제 API 응답, 실기기 앱 호출, 운영 인프라 — `docs/RELEASE_STATUS.md`, `docs/FIRST_RUN.md`

## 빠른 시작
요구사항: Node.js 22 이상 (`node:sqlite` 사용).
```bash
npm install
npm run dev          # http://localhost:3000  (처음 실행 시 data/dev.sqlite 생성 + 마이그레이션 + 목업 데이터 적재)
```
목업을 끄려면 `PARKING_MOCK_DATA=false`. 환경변수는 `.env.example`을 참고해 `.env.local`에 작성합니다(커밋 금지). 검색은 목적지 `서울시청`·`광화문`·`서울역`·`을지로입구`(목업 지오코더) 또는 "현재 위치 사용"으로 합니다.

## 명령
| 명령 | 설명 |
|---|---|
| `npm run lint` / `typecheck` / `test` / `build` | 품질 검사 (CI와 동일) |
| `npm run db:migrate` / `db:reset` | 개발 DB 마이그레이션 / 삭제 |
| `npm run sync:standard` | 표준데이터 수집 — `DATA_GO_KR_SERVICE_KEY` 필요, 실응답 미검증 |
| `npm run sync:holidays` | 공휴일 수집 — `DATA_GO_KR_SERVICE_KEY` 필요, 실응답 미검증 |
| `npm run sync:seoul` | 서울 시영주차장 실시간 수집 — `SEOUL_OPENAPI_KEY` 필요 |
| `npm run sync -- --fixture <json>` | 픽스처(샘플) 수집 — `tests/fixtures/standard-parking.sample.json` |
| `npm run duplicates [-- approve\|reject <id> --by 이름]` | 중복·연결 후보 검토/승인 (서울 실시간 연결에 필요) |
| `npm run quality` | 데이터 품질·운영 알림 리포트 (ERROR 알림이 있으면 종료 코드 1) |
| `npm run profile [-- <원천명>]` | 수집된 원천의 값 분포 점검 |
| `npm run a11y` | 접근성 자동 점검(axe) — 앱 실행 중, playwright 별도 필요 |

## 문서 지도
| 문서 | 내용 |
|---|---|
| `CLAUDE.md`, `docs/PRD.md` | 제품 결정·요구사항 (먼저 읽기) |
| `docs/OPEN_ISSUES.md` | 미확정 사항, **원천 조사 결과와 결정 기록**, 문서 간 충돌 |
| `docs/DEVELOPMENT_LOG.md` | 단계별 구현 내용과 한계 |
| `docs/RELEASE_STATUS.md` | 출시 체크리스트 대비 현황 (검증/부분/대기) |
| `docs/FIRST_RUN.md` | API 키 발급 후 첫 실호출 검증 절차 |
| 그 외 `docs/*.md` | 도메인별 설계 기준(요금 계산, 검색, 실시간, 보안, API 등) |

## 핵심 원칙
- 초기 대상은 **공영주차장**입니다. 민영주차장은 제외합니다.
- 노상·노외 공영주차장 및 무료 개방 주차장을 모두 다룹니다.
- 정보가 없거나 확인되지 않은 항목은 추정하지 않고 `정보 없음` 또는 `실시간 확인 불가`로 표시합니다.
- 요금은 사용자가 입력한 주차 시작·종료 시각을 기준으로 계산합니다.
- 외부 공공데이터 API를 브라우저에서 직접 호출하지 않고 서버에서 수집·정규화합니다.
- 이 문서는 개발 착수용 기준안이며, 실제 API 제공 범위와 이용 조건은 연동 전 검증해야 합니다.
