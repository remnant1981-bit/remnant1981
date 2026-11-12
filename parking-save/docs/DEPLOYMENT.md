# 배포 가이드 (플랫폼 중립)

운영 인프라는 미결정(OPEN_ISSUES #10: AWS Lightsail 서울 / Fly.io 도쿄 / Naver Cloud Micro VPS 비교 보류). 세 후보 모두 Docker 컨테이너를 실행할 수 있으므로 이미지 하나로 공통 대응한다. 플랫폼별 세부 설정은 결정 후 이 문서에 추가한다.

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
- 제외: 목업·샘플 원천, 좌표 없는 시설(건수만 표시), 실시간 잔여면수(정적 페이지라 신선도 보장 불가).
- 공휴일이 DB에 없으면 넣지 않으며, 요일별 규칙 시설은 판정 불가로 표시된다.
- 전국 약 1.6만 곳 기준 약 3.2MB. 데이터 갱신 후 다시 빌드해 같은 링크에 재게시한다.
