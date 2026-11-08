# 수집 원천 현황
| 원천 | 상태 | 비고 |
|---|---|---|
| 테스트(모의) 데이터 | 활성(mock) | 개발·테스트용. UI에 '테스트 데이터' 표시, sitemap/색인 제외 |
| 관리자 수동 등록 | 활성 | 공식 원문 URL 필수 |
| **기업마당** | **연동 완료(live) · PC 실수집 검증(2026-11-08, 1,326건)** | `src/collector/bizinfo.ts`. 실응답 2건으로 파싱 보정 완료. 클라우드 IP는 기업마당이 차단 → **수집은 국내 IP 환경(PC·국내 서버)에서만 가능**. 수집·재실행 멱등·`live` 전환 확인 |
| **K-Startup**(창업진흥원) | **어댑터 구현(pending_key)** | `src/collector/kstartup.ts`. 공공데이터포털 15125364, 무료·이용허락범위 제한 없음. `DATA_GO_KR_API_KEY` 설정 + 관리자 화면 활성화 후 수집. 실호출 검증 전 |
| 중소벤처기업부·과기정통부·IRIS·중소벤처24·판판대로·경기도/경기TP·시흥시/시흥산업진흥원 | **미연동·비활성** | API 이용조건·쿼터·약관·재배포 범위·robots 확인 전(OPEN_ISSUES #1,#7). 관리자 화면에서 활성화 불가 |

실 원천 추가 방법: `src/collector/types.ts`의 `SourceAdapter.fetch()`만 구현 → `scripts/collect.ts`/관리자 실행에 등록 → 약관 확인 후 `data_sources.integration_status='live'`로 변경.

## 기업마당 연동 상세
- 호출: `GET https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=…&dataType=json&pageUnit=100&pageIndex=n` (페이지 간 300ms 대기, 최대 30페이지)
- 키 발급: https://bizinfo.go.kr/apiList.do → 사용신청(기관명·신청자·이메일·시스템 IP/URL 입력, 개인정보 동의). 발급 후 `BIZINFO_API_KEY` 환경변수 설정 → 관리자 화면에서 기업마당 ‘활성화’ → ‘수집 실행’ 또는 `npm run collect`.
- 매핑: 공고ID(pblancId)→source_notice_id, 공고URL→원문/canonical, 소관기관→지원기관, 지원분야 대분류→분야(금융/기술/인력/수출/내수/창업만 매핑, 경영·기타는 미분류), 해시태그의 지역→지역(없으면 전국, 복수면 “첫 지역 외 N곳”, 전남광주는 원문 표기), 신청기간(YYYYMMDD ~ YYYYMMDD)→접수기간(날짜 형식이 아니면 null=상태 확인 필요, 원문 표기는 신청방법란에 보존), 첨부파일/본문출력파일→첨부.
- 알려진 제한: 자격요건이 구조화돼 있지 않아 적합성은 대부분 ‘확인 필요’. 복수 지역 공고는 지역 필터가 첫 지역에만 매칭. JSON 최상위 구조는 문서 예시 비공개로 여러 형태를 허용해 파싱(실응답 확인 필요). 재배포·출처표시 요건은 사용신청 약관 확인 필요(출처명 ‘기업마당’ 및 공식 원문 링크는 이미 표시).

## 기업마당 실호출 확인 절차 (PC 실행)
클라우드 세션(해외 IP)에서는 기업마당이 연결을 리셋해 호출할 수 없음(2회 확인, 메인 페이지 포함). 국내 IP PC에서 실행:
1. `cd govbiz-finder && npm ci`
2. PowerShell: `$env:BIZINFO_API_KEY="발급키"; npx tsx scripts/probe-bizinfo.ts --save` (키는 화면·파일에 출력되지 않음)
3. 응답 구조가 나오면 `probe-bizinfo.out.json`(키 미포함)을 공유 → 어댑터 파싱 보정.
4. 이어서 `npx tsx scripts/probe-bizinfo.ts --collect`: 임시 DB에 최대 30건 수집, 재실행 멱등, `live` 전환 확인.
키가 신청 시 입력한 IP에 묶여 있으면 해당 PC의 공인 IP에서 실행해야 함.

### 실응답 확인 결과(2026-11-07, 2건)
- 최상위 `jsonArray` 확인. 신청기간 `reqstBeginEndDe`는 `YYYY-MM-DD ~ YYYY-MM-DD`(하이픈) 형식, `totCnt`·`inqireCo`는 숫자.
- 해시태그 필드는 소문자 `hashtags`. 전국 대상 공고는 17개 시도 태그를 모두 나열 → 15개 이상이면 `전국`으로 처리.
- 첨부 `fileNm`/`flpthNm`은 `@`로 여러 개가 이어지고 URL에 서명 토큰이 포함 → 토큰 URL은 저장하지 않고 파일명만 보존, 링크는 공식 공고 상세로 연결.
- 지원분야 중분류(`pldirSportRealmMlsfcCodeNm`)의 "사업화" 등을 분야 태그에 반영.
- 인증키가 사용신청 시 입력한 IP에 묶여 있는지는 미확인. 필요 시 기업마당(02-867-9765)에 문의.

## K-Startup 연동 상세
- 호출: `GET https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01?serviceKey=…&page=n&perPage=100&returnType=json&rcrt_prgs_yn=Y` (페이지 간 300ms, 최대 20페이지)
- 키 발급: data.go.kr 로그인 → '창업진흥원_K-Startup(사업소개,사업공고,콘텐츠 등)_조회서비스' 활용신청(자동승인) → 마이페이지의 **일반 인증키(Decoding)** 를 `DATA_GO_KR_API_KEY`로 설정. 공공데이터포털 키는 계정 단위라 국세청 상태조회 등 다른 활용신청에도 같은 키 사용.
- 매핑: pbanc_sn→원천 ID, detl_pg_url→원문, biz_pbanc_nm→공고명, pbanc_ntrp_nm→기관, supt_regin(약칭·쉼표)→지역, pbanc_rcpt_bgng/end_dt(YYYYMMDD)→접수기간, supt_biz_clsfc→분야(+창업), aply_trgt/biz_enyy/biz_trgt_age/aply_trgt_ctnt→자격요건 원문, biz_enyy 상한(‘N년미만’ 최대값)→업력 규칙(신뢰도 0.6), 모집 종료(rcrt_prgs_yn=N) 제외.
- 기업마당과 같은 공고는 중복 판정(정규화 제목·기관)으로 병합.
