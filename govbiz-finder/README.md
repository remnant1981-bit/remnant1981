# GovBiz Finder

기업지원사업(중앙부처·공공기관·지자체) 통합 검색·맞춤 추천 서비스. 설계 기준은 `CLAUDE.md`, `docs/*.md`.

## 빠른 시작
```bash
cd govbiz-finder
npm install
npm run db:migrate      # data/dev.sqlite 생성 (node:sqlite, Node 22+)
npm run db:seed         # 참조데이터 + 테스트(모의) 공고 + 관리자 admin@example.test (임시 비밀번호 1회 출력)
npm run dev             # http://localhost:3000
```
개발 모드에서는 비밀키가 없으면 `data/.devkeys.json`(커밋 제외)에 자동 생성. **운영(NODE_ENV=production)에서는 `.env.example`의 비밀키 3종이 필수**이며 없으면 기동 후 요청이 실패한다.
기업 관계 확인은 관리자 화면(`/admin`)에서 승인. 개발 편의용 `DEV_AUTO_APPROVE_COMPANY=true`는 production에서 무시됨.

## 명령
| 명령 | 설명 |
|---|---|
| `npm run lint` / `typecheck` / `test` / `build` | 품질 검사 |
| `npm run collect` | 활성 원천 수집 + 알림 생성(현재 mock 어댑터만) |
| `npm run db:reset` | 개발 DB 삭제 |

## 구현 상태
| 영역 | 상태 |
|---|---|
| 검색·필터·정렬·페이지네이션·상세·출처/최종확인 | 구현 |
| 수집 프레임워크(어댑터·정규화·중복제거·재시도·로그) | 구현. 기업마당 어댑터 구현(키 발급 전이라 실호출 미검증), 그 외 원천 미연동(mock, 수동 등록) — `docs/DATA_SOURCES.md` |
| 국세청 상태조회 | adapter 구현(mock 기본, 키 설정 시 실호출 경로). **실연동 미검증** |
| 회원·세션·CSRF·rate limit·잠금 | 구현 |
| 기업 관계 확인 | 관리자 수동 승인만. 본인확인/증빙 연동 **미구현**(OPEN_ISSUES #4) |
| 규칙 기반 적합성, 비회원 체험 | 구현(AI 미사용) |
| XLSX/CSV/PDF/인쇄 | 구현 |
| 관심공고·이력·앱 내 알림 | 구현. 이메일/카카오/SMS **미구현** |
| 관리자(공고 CRUD·수집 현황·승인·감사 로그) | 구현 |
| 계정 복구, 직원 초대, AI 공고 구조화 | 미구현(후속) |

## 알려진 제한
`docs/DEVELOPMENT_LOG.md` 참조.
