# 무인 운영 파이프라인

목표: 서버를 한 번 설치한 뒤에는 **손대지 않아도** 수집·배포·백업·감시가 돌아가게 한다.

## 전체 흐름
```
[개발] PR → GitHub Actions(테스트·빌드) 통과 → main 머지
            ↓ (15분 이내 자동)
[국내 서버] govbiz-update.timer → release.sh: 새 폴더에 설치·빌드·DB 마이그레이션
            ├ 성공 → 새 버전으로 교체·재시작
            └ 실패 → 기존 버전 계속 서비스(자동 롤백)
[수집]   govbiz-collect.timer: 매일 08:30·13:30·18:30(KST) 기업마당 수집 → 접수 상태 재계산 → 맞춤 알림 생성
[백업]   govbiz-backup.timer: 매일 03:10 DB 백업(무결성 확인), 14일 보관
[HTTPS]  Caddy: 인증서 자동 발급·갱신
[감시]   UptimeRobot → /api/health 5분 간격
            ├ 사이트 다운 → 알림
            └ 수집이 26시간 넘게 성공 못함(키 만료·차단 등) → 503 → 알림
```

## 처음 한 번만 할 일 (사람)
| 순서 | 할 일 | 비고 |
|---|---|---|
| 1 | 도메인 구입 | 연 약 ₩2만 |
| 2 | 국내 리전 서버 생성(Lightsail 서울 $12, Ubuntu 24.04) | 고정 IP 연결, 방화벽 80·443 허용 |
| 3 | 도메인 A 레코드 → 서버 고정 IP | |
| 4 | 기업마당 API 키를 **서버 고정 IP**로 신청(또는 기존 키 IP 변경 문의 02-867-9765) | 키가 IP에 묶여 있을 수 있음 |
| 5 | 서버에서 `sudo DOMAIN=도메인 ADMIN_EMAIL=이메일 BIZINFO_API_KEY=키 bash setup-server.sh` | 관리자 초기 비밀번호가 1회 표시됨 |
| 6 | UptimeRobot 무료 가입 → HTTP 모니터 `https://도메인/api/health` | 알림 받을 이메일·앱 설정 |
| 7 | (승인 후) 애드센스 코드 값을 서버 `.env`의 `NEXT_PUBLIC_ADSENSE_*`에 입력 → `FORCE=1` 배포 | 광고 표시 시작 |

### 배포 진행 현황(2026-11-08 기준, 이어서 진행할 때 참고)
- Oracle Cloud: 가입 화면에 한국 리전(서울·춘천) 없음 → **중단**(해외 리전은 기업마당 수집 불가 가능성)
- AWS Lightsail 서울(3개월 무료만 사용) 진행 중: **계정 플랜 선택 화면에서 일시 중단**
  - 결정: **Free 플랜(6개월, 크레딧 최대 $200, 크레딧 초과 과금 없음)** 선택 예정
  - 확인 필요: Free 플랜에서 Lightsail 생성 가능 여부(막히면 대안 검토), 화면에 Lightsail '3개월 무료' 표시 여부
  - 다음 순서: Choose free plan(직접 클릭) → 인증·카드(직접) → 콘솔 진입 → Budgets 알림 → Lightsail 서울 인스턴스(스냅샷 끔·1대) → 고정 IP·방화벽 → setup-server.sh
  - Free 플랜은 6개월 후 또는 크레딧 소진 시 유료 전환을 선택하지 않으면 계정이 자동 종료됨 → 종료 전 DB 백업 다운로드 필요

### Oracle Cloud 무료 서버(Always Free)로 시작하는 경우
- Home Region 서울/춘천, Ampere A1(OCPU 2·메모리 12GB), Ubuntu 24.04, 공인 IP 할당
- 콘솔 Security List 에 TCP 80·443 Ingress 추가(OS 방화벽은 setup-server.sh 가 자동 개방)
- 도메인 없이 시작 가능: `DOMAIN` 생략 시 `공인IP.sslip.io` 주소로 HTTPS 자동 구성. 도메인 구입 후 `.env`의 `SITE_URL`과 `/etc/caddy/Caddyfile`의 주소만 바꾸고 `sudo systemctl reload caddy` + `FORCE=1` 배포
- 설치 중 `[1c]` 단계에서 기업마당 접속 가능 여부를 출력함(국내 IP 확인)

설치 스크립트 받는 법: `git clone https://github.com/remnant1981-bit/remnant1981.git && cd remnant1981/govbiz-finder/deploy`

## 평소 (자동)
- 코드 개선은 PR 머지만 하면 서버에 자동 반영된다.
- 장애 알림이 올 때만 확인: 대부분 기업마당 키·IP 문제이며 관리자 화면 "수집 원천·모니터링"의 마지막 오류에 원인이 표시된다.

## 수동 명령(필요할 때만)
| 목적 | 명령(서버) |
|---|---|
| 즉시 배포 | `sudo -u govbiz FORCE=1 bash /opt/govbiz/repo/govbiz-finder/deploy/release.sh` |
| 즉시 수집 | `sudo systemctl start govbiz-collect` |
| 로그 | `journalctl -u govbiz-web -u govbiz-collect -n 100` |
| 복구 | `gunzip -k 백업.sqlite.gz` 후 서비스 중지 → `DATABASE_PATH` 파일 교체 → 시작 |

## 파일
`deploy/setup-server.sh`(1회 설치), `deploy/release.sh`(무중단 배포·롤백), `deploy/backup.sh`, `deploy/Caddyfile`, `deploy/systemd/*`(웹·수집·백업·자동배포), `deploy/sudoers-govbiz`(재시작 권한만).
