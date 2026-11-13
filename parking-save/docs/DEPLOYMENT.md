# 배포 가이드

운영 인프라: **네이버클라우드 Micro**(사용자 결정 2026-11-12, OPEN_ISSUES #10). 실제 설치 절차는 **9절**. 1~8절은 Docker 이미지 기준의 공통 내용이라 다른 플랫폼에도 그대로 적용된다.

## 1. 구성

| 구성 요소 | 내용 |
|---|---|
| 앱 | Next.js standalone 서버(`node server.js`), 포트 3000 |
| DB | SQLite 파일 `/data/parking.sqlite` (볼륨 영속화 필수). 첫 요청 때 `migrations/` 자동 적용 |
| 수집 | 컨테이너 밖 스케줄러(cron 등)가 `POST /api/admin/sync` 호출. 이미지에 수집 스크립트(tsx) 없음 |
| 헬스체크 | `GET /api/health` → `{"status":"ok","lastSuccessfulSync":{원천: 시각}}`, DB 오류 시 503 |
| 앞단 | HTTPS 종료·`X-Forwarded-For` 부착을 하는 리버스 프록시/로드밸런서 필수(아래 4절) |

## 2. 빌드·실행

```bash
cd parking-save
docker build -t parking-save .
docker volume create parking-data
docker run -d --name parking-save -p 3000:3000 -v parking-data:/data \
  --env-file /안전한/경로/parking.env parking-save
curl -s localhost:3000/api/health
```

이미지 기본값: `NODE_ENV=production`, `DATABASE_PATH=/data/parking.sqlite`, `PARKING_MOCK_DATA=false`.
`PARKING_MOCK_DATA`를 설정하지 않아도 운영(production)에서는 목업이 꺼진다(개발·테스트에서만 기본 켜짐).

### 환경변수 (`.env.example` 참고, 값은 플랫폼 비밀 저장소에)

| 변수 | 필수 | 설명 |
|---|---|---|
| `SITE_URL` | 예 | 운영 도메인(https). 네이버 지도 `appname`·canonical |
| `ADMIN_API_TOKEN` | 예 | 32자 이상 무작위. 없으면 관리자 API 비활성(수집 불가). `openssl rand -base64 32` |
| `DATA_GO_KR_SERVICE_KEY` | 예 | 표준데이터·특일 정보 공용 |
| `SEOUL_OPENAPI_KEY` | 선택 | 서울 실시간. 없으면 서울 job 거부 |
| `ADMIN_AUDIT_SALT` | 권장 | 감사로그 클라이언트 해시 솔트 |
| `TRUSTED_PROXY_COUNT` | 권장 | 앱 앞 프록시 단계 수(기본 1). 4절 참고 |
| `STANDARD_PAGE_SIZE`, `SEOUL_OPENAPI_BASE` | 선택 | 기본값 사용 가능 |

## 3. 정기 수집 (스케줄러 → 관리자 API)

```bash
# 예: 호스트 crontab (KST 기준 서버라면 시각 그대로, UTC 서버면 -9시간)
# 표준데이터: 매일 04:17
17 4 * * *   curl -fsS -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" -d '{"job":"standard-parking"}' https://도메인/api/admin/sync
# 공휴일: 매주 월 04:47 (커버리지 유효기간 7일 — 주 1회 이상 필수)
47 4 * * 1   curl -fsS -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" -d '{"job":"holidays"}' https://도메인/api/admin/sync
# 서울 실시간: 5분마다 (신선도 기준 20분)
*/5 * * * *  curl -fsS -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" -d '{"job":"seoul-occupancy"}' https://도메인/api/admin/sync
```

- 같은 job이 실행 중이면 409(`ALREADY_RUNNING`) — 겹쳐 호출해도 안전.
- 관리자 API는 클라이언트당 분당 5회 제한. 서울 5분 주기 + 다른 job은 한도 안.
- 실패 감지: `curl -f`의 종료 코드로 스케줄러 알림, 또는 `/api/health`의 `lastSuccessfulSync`가 오래되면 경보. 품질 리포트는 `npm run quality`(개발 환경에서 DB 사본으로).
- ⚠ 표준데이터 전체 수집은 약 1~2분(원천 응답 73초 + 적재 7초 실측). 프록시 타임아웃을 3분 이상으로.

## 4. 리버스 프록시 필수 조건

요청 제한(검색 분당 60회, 관리자 분당 5회)은 `X-Forwarded-For`의 **끝에서 N번째 값**으로 클라이언트를 구분한다(`src/server/rate-limit.ts`). 프록시는 이 헤더 끝에 자기가 본 접속 IP를 덧붙이므로, 앞쪽 값은 클라이언트가 위조할 수 있다.

- `TRUSTED_PROXY_COUNT` = 앱 앞의 프록시 단계 수(기본 1). 예: 로드밸런서만 → 1, CDN → 로드밸런서 → 2. 실제 구성과 다르면 모든 사용자가 같은 키로 묶이거나(값이 너무 큼) 위조가 가능해짐(값이 너무 작음).
- nginx는 기본 설정(`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, 덧붙이기)으로 충분하다.
- 앱 포트(3000)를 인터넷에 직접 노출하지 말 것 — 프록시 없이 받으면 헤더 전체가 클라이언트 입력이라 제한 우회 가능.
- 제한은 프로세스 메모리 기반 → 인스턴스 1개 기준. 여러 개로 늘리면 엣지(CDN/WAF) 제한으로 교체.

## 5. 백업·복구

```bash
# 온라인 백업(WAL 안전): 컨테이너 안에서 node:sqlite로 VACUUM INTO
docker exec parking-save node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/parking.sqlite').exec(\"VACUUM INTO '/data/backup-$(date +%F).sqlite'\")"
docker cp parking-save:/data/backup-$(date +%F).sqlite ./
```

- 원천 데이터는 재수집으로 복구 가능하지만, `duplicate_candidates`의 관리자 승인·`admin_audit_logs`는 재수집으로 복구되지 않으므로 백업 대상.
- 복구: 컨테이너 중지 → 볼륨의 `parking.sqlite`(및 `-wal`·`-shm` 삭제) 교체 → 시작.

## 6. 첫 배포 체크리스트

1. `docker run` 후 `/api/health` 200 확인
2. 관리자 API로 `holidays` → `standard-parking` 순서로 수집(공휴일 없으면 요일별 규칙 시설이 계산 불가)
3. `docs/FIRST_RUN.md` 절차(값 분포·품질 리포트) 수행
4. 검색 화면에서 목업 배너가 **없는지** 확인(운영 데이터만 표시)
5. 스케줄러 등록 후 다음 날 `lastSuccessfulSync` 갱신 확인
6. `docs/RELEASE_CHECKLIST.md` 나머지 항목

## 7. Cloudflare D1 (참고)

`src/server/db.ts`에 D1 어댑터(`createD1Db`)가 있으나 미검증이고 트랜잭션(원자성)이 없다. 위 세 후보는 모두 VM/컨테이너라 SQLite 파일 방식을 기본으로 한다.

## 8. 정적 데모 페이지

서버 없이 공유 링크로 보여줄 수 있는 단일 HTML. 앱과 같은 요금·운영 판정 코드(`src/domain/*`)를 번들해 브라우저에서 계산한다.

```bash
npm run demo:build -- --db ./data/dev.sqlite --out ./data/demo/parking-save-demo.html
```

- 포함: 표준데이터(`DATA_GO_KR_15012896`) 중 좌표 있는 시설, 요금 규칙·운영시간, 동일 시설 후보(승인 또는 점수 1.0), 공휴일(목업 원천 제외한 가장 넓은 커버리지 1개).
- 기능: 검색·정렬 4종(가성비 포함)·필터, 날짜별 요금 내역·요금 그래프·더 싼 시간대, 요금 이상치 경고, 감면·할인 대상, 월 정기권(장기 이용 안내), 나란히 비교(최대 3곳, 페이지 안에서만 유지), 즐겨찾기·최근 검색(브라우저 저장).
- 제외: 목업·샘플 원천, 좌표 없는 시설(건수만 표시), 실시간 잔여면수(정적 페이지라 신선도 보장 불가).
- 공휴일이 DB에 없으면 넣지 않으며, 요일별 규칙 시설은 판정 불가로 표시된다.
- 전국 약 1.6만 곳 기준 약 3.2MB. 데이터 갱신 후 다시 빌드해 같은 링크에 재게시한다.

## 9. 네이버클라우드 Micro 설치 (운영)

구성: GitHub Actions가 이미지를 빌드해 GHCR(`ghcr.io/remnant1981-bit/parking-save`)에 올림 → 서버는 받아서 실행만 함(1GB 메모리로 `next build`는 빠듯). 서버 안에서 nginx(HTTPS) → 앱(127.0.0.1:3000), cron이 수집·백업.

### 9-1. 콘솔에서 할 일 (사용자)

> 콘솔 메뉴명·Micro 무료 조건은 이 세션에서 확인하지 못했음. 화면이 다르면 같은 의미의 항목을 찾을 것.

1. **서버 생성**: Micro(1vCPU/1GB), OS **Ubuntu 22.04 또는 24.04**, 공인 IP 할당.
2. **ACG(방화벽) 인바운드**: TCP 80·443 전체 허용, TCP 22는 **본인 IP만**. 3000은 열지 않음.
3. **아웃바운드**: 기본 전체 허용이면 그대로. 제한한다면 `apis.data.go.kr`(443), `api.data.go.kr`(443), `openapi.seoul.go.kr`(8088, http), `ghcr.io`(443), Let's Encrypt(443) 허용.
4. **도메인**: DNS A 레코드를 서버 공인 IP로. 도메인이 없으면 임시로 `<IP를 하이픈으로>.sslip.io`(예: `203-0-113-10.sslip.io`)도 가능하나 인증서 발급 한도가 공유돼 실패할 수 있음. **HTTPS가 없으면 '현재 위치 사용'이 동작하지 않음**(브라우저 보안 정책).

### 9-2. 이미지 준비 (최초 1회)

- 이 PR이 main에 머지되면 `.github/workflows/parking-image.yml`이 이미지를 GHCR에 올린다(Actions 탭에서 확인).
- 저장소가 비공개면 패키지도 비공개 → 서버에서 `docker login ghcr.io -u <GitHub 사용자명>` 후 비밀번호 자리에 `read:packages` 권한 토큰 입력. 또는 GitHub 패키지 설정에서 공개로 전환.

### 9-3. 서버에서 실행

```bash
# SSH 접속 후
git clone https://github.com/remnant1981-bit/remnant1981.git   # 비공개면 토큰 필요. 또는 deploy/naver 폴더만 scp
cd remnant1981/parking-save/deploy/naver
sudo DOMAIN=parking.example.com EMAIL=you@example.com bash setup.sh
```

`setup.sh`가 하는 일: 시간대 Asia/Seoul, 스왑 2GB, docker·nginx·certbot 설치, `/etc/parking-save/env` 생성(관리자 토큰 무작위 생성, 권한 600), 이미지 실행(127.0.0.1:3000, 메모리 700MB 제한, 로그 30MB 상한), nginx 설정(`/api/admin`은 외부 404), HTTPS 인증서, cron 등록. 다시 실행해도 안전.

### 9-4. 키 입력 후 첫 수집

```bash
sudo nano /etc/parking-save/env        # DATA_GO_KR_SERVICE_KEY, SEOUL_OPENAPI_KEY 입력
sudo parking-update                    # 환경변수 반영(컨테이너 재생성, 데이터 유지)
sudo parking-sync holidays             # 공휴일 먼저
sudo parking-sync standard-parking     # 표준데이터(1~2분)
tail /var/log/parking-save-sync.log
curl -s https://<도메인>/api/health
```

### 9-5. 운영 명령

| 명령 | 용도 |
|---|---|
| `sudo parking-update` | 최신 이미지로 교체(main 머지 후 Actions 완료 → 실행). 데이터 볼륨 유지, 헬스체크 실패 시 종료 코드 1 |
| `sudo parking-sync <job>` | 수동 수집(`standard-parking`·`holidays`·`seoul-occupancy`). 결과는 `/var/log/parking-save-sync.log` |
| `sudo parking-reports` | 이용자 정보 오류 신고 검토 대기 목록. `parking-reports reviewed <id> <이름>` / `dismiss <id> <이름>`로 처리(원천 데이터 수정은 별도). `npm run quality`에도 대기 건수 표시 |
| `sudo parking-backup` | 즉시 백업 → `/var/backups/parking-save/parking-YYYY-MM-DD.sqlite`(14일 보관, 매일 03:37 자동). 백업본 `integrity_check` 통과 시에만 보관, 실패 시 알림 |
| `sudo parking-restore-test [파일]` | 백업 복원 리허설: 최신 백업을 네트워크 없는 임시 컨테이너에서 읽기 전용으로 열어 무결성·외래키·시설 수 확인(매주 일 05:13 자동, 실패 시 알림). 운영 DB는 건드리지 않음 |
| `sudo parking-alert` | 헬스체크 + 품질 리포트 ERROR 점검 후 `ALERT_WEBHOOK_URL`로 전송(15분마다 자동, 같은 내용은 6시간에 1회). `parking-alert "메시지"`로 즉시 전송. 기록: `/var/log/parking-save-alert.log` |
| `curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/admin/db-check` | DB 무결성 전체 점검(수 초). 이상 시 HTTP 500 |
| `docker logs --tail 100 parking-save` | 앱 로그(한 줄 JSON: `ts·level·event` + 필드). 좌표·검색어·토큰·인증키는 기록하지 않음(가림 처리). 오류만: `docker logs parking-save 2>&1 \| grep '"level":"error"'` |
| 관리자 화면 | 외부에서는 404(nginx 차단). PC에서 `ssh -L 3000:127.0.0.1:3000 <서버>` 후 브라우저로 `http://localhost:3000/admin` → `/etc/parking-save/env`의 `ADMIN_API_TOKEN` 입력. 신고·중복 후보 처리, 수집 상태·이력 그래프, 품질 리포트, **요금·운영시간 수동 보정**(확인 근거 필수, 되돌리기 가능, 수집 후에도 유지) |

- **지도 배경 교체**(트래픽이 늘면 OSM 정책상 필요): 브이월드(국토교통부 공간정보 오픈플랫폼, 무료) 인증키를 서비스 도메인으로 발급 → `/etc/parking-save/env`에 `MAP_TILE_PROVIDER=vworld`, `VWORLD_API_KEY=<키>` 추가 → `sudo parking-update`. 다시 빌드할 필요 없음. 키가 없거나 형식이 틀리면 OSM으로 자동 복귀하고 헬스체크가 `degraded`(`MAP_TILE_FALLBACK`) → 운영 알림. 브이월드 주소 형식은 공개 자료 기준이며 실제 키로는 미검증 — 설정 후 검색 화면 '지도' 탭에서 배경이 보이는지 확인. 네이버 지도는 자체 SDK가 필요해 이 설정으로는 바꿀 수 없음(별도 개발).
- **검색 엔진 등록**: 도메인 연결 후 `SITE_URL`을 실제 주소(https)로 설정해야 sitemap·공유 이미지 주소가 맞음. 네이버 서치어드바이저·구글 서치 콘솔에 `https://<도메인>/sitemap.xml` 제출(사용자 작업).
- **알림 웹훅**: `/etc/parking-save/env`의 `ALERT_WEBHOOK_URL`에 Slack(Incoming Webhook)·Discord 웹훅 주소 입력(본문에 `text`·`content` 둘 다 넣어 양쪽 호환). 비워 두면 로그 파일에만 기록. 웹훅 주소도 비밀값으로 취급.
- **헬스체크 응답**: `status`가 `ok`/`degraded`/`error`. `degraded`(마이그레이션 누락·표준데이터 수집 50시간 초과·최근 5분 오류 20건 이상)는 HTTP 200이라 컨테이너를 재시작하지 않고 알림만 보냄. DB를 열 수 없으면 503 → Docker가 재시작.
- **복원 절차**(실제 장애 시): `sudo parking-restore-test <백업>`으로 먼저 확인 → `docker stop parking-save` → `docker run --rm -v parking-data:/data -v <백업>:/b.sqlite:ro --entrypoint sh <이미지> -c 'cp /b.sqlite /data/parking.sqlite && rm -f /data/parking.sqlite-wal /data/parking.sqlite-shm'` → `sudo parking-update`. 백업 이후 수집분은 다음 수집으로 다시 채워짐(관리자 처리 기록은 백업 시점까지).
- 백업은 같은 서버 디스크에 있음 → 서버 장애 대비로 주 1회 이상 PC나 오브젝트 스토리지로 옮길 것(관리자 승인한 중복 후보·감사로그는 재수집으로 복구되지 않음).
- 관리자 API는 서버 안에서만 호출됨(nginx가 외부 차단). 앱은 nginx 1단계 뒤이므로 `TRUSTED_PROXY_COUNT=1`.
- nginx 접속 로그는 쿼리 문자열(검색 좌표·시간)을 남기지 않는 형식(`parkingsave_noquery`)으로 `/var/log/nginx/parking-save.access.log`에 기록 — 처리방침(`/privacy`)과 일치. 로그 순환·보관 기간은 Ubuntu 기본 logrotate(일 단위 14일) 적용 — 정책 확정 시 조정.

### 9-6. 검증 기록 (2026-11-12, 이 세션)

- `update.sh`로 컨테이너 실행 → 헬스 200, `parking-sync holidays`가 관리자 인증 통과(키 미입력이라 400 `KEY_MISSING` 로그), `parking-backup`이 백업 파일 생성·임시 파일 정리.
- `nginx.conf`: `nginx -t` 통과, nginx 경유 시 `/api/admin/sync` 404·`/api/health` 200·홈 200.
- 미검증: 실제 네이버클라우드 VM에서의 `setup.sh` 전체 실행(systemd·certbot·apt), GHCR 푸시 워크플로(머지 후 첫 실행에서 확인).
