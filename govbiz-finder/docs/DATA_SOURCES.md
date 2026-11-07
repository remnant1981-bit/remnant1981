# 수집 원천 현황
| 원천 | 상태 | 비고 |
|---|---|---|
| 테스트(모의) 데이터 | 활성(mock) | 개발·테스트용. UI에 '테스트 데이터' 표시, sitemap/색인 제외 |
| 관리자 수동 등록 | 활성 | 공식 원문 URL 필수 |
| 기업마당·중소벤처기업부·K-Startup·과기정통부·IRIS·중소벤처24·판판대로·경기도/경기TP·시흥시/시흥산업진흥원 | **미연동·비활성** | API 이용조건·쿼터·약관·재배포 범위·robots 확인 전(OPEN_ISSUES #1,#7). 관리자 화면에서 활성화 불가 |

실 원천 추가 방법: `src/collector/types.ts`의 `SourceAdapter.fetch()`만 구현 → `scripts/collect.ts`/관리자 실행에 등록 → 약관 확인 후 `data_sources.integration_status='live'`로 변경.
