# 정기 수집·알림 스케줄 설정

`npm run collect`는 **관리자 화면에서 활성화된 원천**만 실행하고(기업마당은 `BIZINFO_API_KEY` 필요), 끝에 앱 내 알림을 생성한다.
종료 코드: 0 = 모두 성공, 1 = 실패 있음(스케줄러의 실패 알림용). 키와 요청 URL은 출력하지 않는다.
**기업마당은 해외 IP를 차단하므로 국내 IP 환경(사무실 PC·국내 서버)에서 실행해야 한다.**

## 권장 주기
- 수집: 하루 1~2회(예: 08:30, 14:30). 기업마당은 공고가 하루 수십 건 갱신되는 수준이므로 시간당 호출은 불필요.
- 알림 생성은 수집 직후 같은 스크립트에서 실행됨(중복 알림은 자동 방지).

## Windows 작업 스케줄러 (PC)
1. 아래 내용으로 `C:\Users\User\collect-govbiz.bat` 생성 (키는 이 파일 안에만 두고 저장소에 올리지 않는다)
```bat
@echo off
cd /d C:\Users\User\remnant1981\govbiz-finder\remnant1981\govbiz-finder
set DATABASE_PATH=./data/real.sqlite
set BIZINFO_API_KEY=발급키
call npm run collect >> collect.log 2>&1
```
2. 작업 스케줄러 → 기본 작업 만들기 → 매일, 시간 지정 → 프로그램: 위 bat 파일. "가장 높은 권한" 불필요.
3. `collect.log`에서 결과 확인(`success` / 오류 문구). 로그에 키는 남지 않는다.
- PC가 꺼져 있으면 실행되지 않는다. 상시 운영은 국내 서버를 권장.

## Linux (국내 서버) cron
```
30 8,14 * * *  cd /srv/govbiz-finder && DATABASE_PATH=./data/prod.sqlite BIZINFO_API_KEY=... npm run collect >> collect.log 2>&1
```
키는 cron 줄 대신 환경 파일(`EnvironmentFile`)이나 비밀 저장소로 주입하는 것을 권장.

## 상태 확인
- 관리자 화면 "수집 원천·모니터링": 마지막 성공/오류, "최근 수집 실행" 건수.
- 상태가 `상태 확인 필요`에서 `접수 중/마감`으로 바뀌는 날짜 기반 추정 상태는 수집 때 함께 재계산된다.
