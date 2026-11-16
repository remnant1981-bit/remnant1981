# 쿠폰 지갑 푸시 서버 (Cloudflare Workers)

앱이 **꺼져 있어도** 만료 임박·적립 마감 알림을 받게 해 주는 작은 서버. Cloudflare Workers + KV **무료 한도**에서 동작하고, 서버를 따로 관리할 필요가 없음.

## 개인정보: 서버에 무엇이 저장되나
| 저장함 | 저장하지 않음 |
|---|---|
| 푸시 주소(endpoint), 기기 비밀값의 **해시**, **알림을 보낼 날짜 목록**, 시간대·알림 시각, 마지막 전송일 | 쿠폰·적립의 이름, 번호, 금액, 메모, 사진 등 **앱 데이터 전부** |

- 서버가 보내는 푸시는 **내용 없는 신호**임. 알림 문구("스타벅스 아메리카노 D-2")는 신호를 받은 기기가 자기 데이터로 만듦.
- 서버 개발자(Cloudflare 계정 소유자)도 어떤 쿠폰이 있는지 알 수 없음.

## 동작
```
앱(설정에서 켜기) ──구독 + 알림 날짜 목록──▶ 서버(KV)
                                              │ 매시 정각 cron: 오늘이 알림 날짜이고, 알림 시각이 지났고, 오늘 아직 안 보냈으면
                                              ▼
                      푸시 서비스(FCM 등) ◀── 내용 없는 푸시 (VAPID 서명)
                              │
기기의 서비스워커 ◀───────────┘  → 이 기기의 데이터로 알림 문구를 만들어 표시
```
- 앱은 데이터가 바뀔 때마다(쿠폰 추가·사용·삭제, 적립 변경 등) 알림 날짜 목록을 서버와 맞춤. 바뀐 게 없으면 네트워크를 쓰지 않음.
- 알림 날짜: 쿠폰은 만료 3일 전~당일, 적립은 마감 7일 전~당일 (앱의 알림 기준과 같음, 오늘부터 90일 이내).
- 알림 시각 이후 3시간 안에 전송에 성공할 때까지 매시 재시도함.

## 설정 (휴대폰만으로도 가능)
필요한 것: **Cloudflare 계정**(무료), 이 GitHub 저장소의 관리자 권한.

1. **Cloudflare 가입** → 대시보드의 *Workers & Pages*를 한 번 열어 `workers.dev` 하위 도메인을 정함(처음 쓰는 계정만).
2. **API 토큰 만들기**: 프로필 → *API Tokens* → *Create Token* → **Edit Cloudflare Workers** 템플릿 → 생성 후 토큰 복사. 대시보드 오른쪽의 **Account ID**도 복사.
3. **GitHub 저장소 Secrets 등록**: 저장소 → *Settings* → *Secrets and variables* → *Actions* → *New repository secret* 로 세 개 추가
   | 이름 | 값 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 2번에서 만든 토큰 |
   | `CLOUDFLARE_ACCOUNT_ID` | 계정 ID |
   | `PUSH_REGISTER_CODE` | **직접 정하는 암호 문구**(8자 이상). 기기 등록 때 앱에 입력함. 서버에 아무나 기기를 등록하지 못하게 막는 용도 |
4. **배포**: 저장소 → *Actions* → **Deploy 쿠폰 지갑 푸시 서버** → *Run workflow*. 끝나면 실행 요약에 **서버 주소**(`https://coupon-wallet-push.○○○.workers.dev`)가 나옴.
5. **앱에서 켜기**: 앱 → 설정(⋯) → **서버 푸시 알림** → 서버 주소·등록 코드 입력, 알림 시각 선택 → **켜기** → **테스트**를 눌러 알림이 오는지 확인.

> 서버 VAPID 키는 첫 요청 때 서버가 자동으로 만들어 KV에 보관함. 별도로 만들거나 등록할 필요 없음.

### PC에서 직접 배포
```bash
cd push-server
npx wrangler login
npx wrangler deploy                      # KV 저장소(SUBS)는 처음 배포할 때 자동으로 만들어짐
npx wrangler secret put REGISTER_CODE    # 등록 코드 입력
```
자동 생성이 안 되는 환경이면 `npx wrangler kv namespace create SUBS` 로 만든 뒤 출력된 `id`를 `wrangler.toml`의 `[[kv_namespaces]]`에 `id = "…"`로 적음.

## 보안
- **등록 코드 필수**: `REGISTER_CODE`가 없으면 서버가 기기 등록을 거부함(503). 틀리면 401.
- **허용 출처**: 브라우저 호출은 `ALLOWED_ORIGIN`(기본: 이 저장소의 GitHub Pages 주소)에서만 가능(CORS + 서버 검사).
- **SSRF 방지**: 서버가 클라이언트가 보낸 주소로 요청을 보내므로, FCM·Mozilla·Apple·Windows 푸시 서비스의 `https` 주소만 허용함(IP·localhost·사용자정보 포함 주소 거부).
- **기기 인증**: 갱신·삭제·테스트는 기기가 가진 비밀값(Bearer)이 있어야 하며, 서버에는 해시만 저장함. 같은 주소를 다른 비밀값으로 덮어쓸 수 없음(409).
- **입력 제한**: 본문 20KB, 날짜 400개, 등록 기기 30대, 갱신 없는 등록은 150일 뒤 자동 삭제.
- 사용자 지정 도메인을 쓰면 앱의 CSP(`coupon-wallet/index.html`의 `connect-src`, 현재 `*.workers.dev`만 허용)에 그 도메인을 추가해야 함.

## API
| 요청 | 설명 |
|---|---|
| `GET /` | 상태 확인 |
| `GET /vapid` | 앱이 구독할 때 쓰는 공개키 |
| `POST /subscribe` | 기기 등록. 헤더 `X-Register-Code` 필요 |
| `PUT /subscribe/:id` | 알림 날짜·시각·시간대 갱신. `Authorization: Bearer <기기 비밀값>` |
| `DELETE /subscribe/:id` | 등록 삭제 |
| `POST /subscribe/:id/test` | 지금 푸시 1회 전송(연결 확인) |

## 한도·비용
- Workers 무료 플랜 한도 안에서 개인용으로 충분함(매시 cron 1회, 기기당 하루 1~3회 전송, KV 읽기/쓰기 소량). 기기가 30대를 넘으면 등록이 거절됨.
- 무료 플랜은 요청 1회당 외부 호출 수 제한이 작아서 cron 1회에 최대 20대까지 처리하고 나머지는 다음 실행에서 처리함.

## 문제 해결
- **알림이 안 옴**: ① 앱을 설치했는지(홈 화면에 추가) ② 브라우저 사이트 설정에서 알림 허용 ③ 안드로이드 배터리 최적화에서 크롬/앱 제외 ④ 앱 설정의 **테스트** 버튼으로 연결 확인 ⑤ 알림 날짜가 아닌 날(임박한 쿠폰이 없는 날)에는 오지 않음.
- **"허용되지 않은 출처임"**: `wrangler.toml`의 `ALLOWED_ORIGIN`이 앱 주소의 origin과 같은지 확인.
- **"등록 코드가 올바르지 않음"**: Secrets의 `PUSH_REGISTER_CODE`와 앱에 입력한 값이 같은지 확인(바꿨다면 워크플로를 다시 실행).
- **배포 중 workers.dev 하위 도메인 오류**: 1번 단계(대시보드에서 하위 도메인 정하기)를 먼저 한 뒤 다시 실행.
- **구독이 만료됨(410)**: 앱에서 껐다가 다시 켜면 새로 등록됨.

## 개발
```bash
cp .dev.vars.example .dev.vars           # REGISTER_CODE 설정
npx wrangler dev --local --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=0+*+*+*+*"   # cron 수동 실행
node --test "tests/push-server/*.test.mjs"                # 서버 단위 테스트(저장소 루트에서)
```
- `src/core.js`: 서버 로직(외부 의존성 없음, Workers/Node 공용) · `src/worker.js`: 진입점
