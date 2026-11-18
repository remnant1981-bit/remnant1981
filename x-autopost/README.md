# X 자동 게시 (x-autopost) — 애드픽 캠페인 홍보

`campaigns.csv`에 애드픽 캠페인 등록 → Claude가 트윗 초안 작성(`queue/`) → 하루 몇 건씩 게시.

## 게시 방식 2가지
| 방식 | 비용 | 동작 | 필요 설정 |
|---|---|---|---|
| **작성 링크 알림 (기본)** | 무료 | 게시 시각에 휴대폰 알림 → 탭 → X 앱에 본문·링크가 채워진 작성 화면 → **[게시] 1번** | ntfy 또는 텔레그램 (tistory-autopost와 공용) |
| X API 자동 게시 | 사용량 과금 | 사람 손 없이 바로 게시 | X API 키 4종 |

- `config.json` → `post_method`: `auto`(키 있으면 API, 없으면 알림) / `intent`(항상 알림) / `api`
- 알림 방식은 X 공식 작성 링크(`x.com/intent/post`)만 사용 → 계정 자동화 규칙 위반 없음
- 알림 방식은 알림을 보낸 시점에 `queue/posted/`로 옮김 (실제 게시 여부는 확인 불가). 놓친 글은 Actions 실행 화면 Summary의 **작성 화면 열기** 링크로 다시 게시
- 브라우저 자동 조작(Selenium 등) 게시는 X 자동화 규칙상 금지(API 외 스크립트 게시) → 계정 정지 위험으로 미지원

### 알림 설정 (무료 방식)
- **ntfy**: 휴대폰에 ntfy 앱 설치 → 남이 못 맞힐 주제 이름 구독 → Secret `NTFY_TOPIC`
- **텔레그램**: Secret `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- 휴대폰에 X 앱이 설치돼 있어야 앱으로 바로 열림 (없으면 브라우저)

```
campaigns.csv ──ai_tweet.py──▶ queue/*.json ──x_poster.py──▶ X(x.com)
                 (Claude 초안)    (검토·수정 가능)   (제한 걸고 1건씩)   → queue/posted/ · post_log.jsonl
```

## 1. 준비
### X API 키 (선택 — 완전 자동 게시를 원할 때만)
1. https://developer.x.com → 개발자 계정 → Project/App 생성
2. App 설정 → **User authentication settings** → App permissions **Read and write** (Read only면 게시 403)
3. Keys and tokens → **API Key/Secret**, **Access Token/Secret** 발급 (권한 변경 후 Access Token 재발급 필요)
4. **요금**: 2026-02부터 신규 개발자는 무료 등급 없이 **사용량 과금(pay-per-use)**, 크레딧 선충전 방식. 링크 포함 게시는 일반 게시보다 단가 높음 (외부 자료 기준 건당 약 $0.01~0.20, 정확한 단가는 developer.x.com 콘솔 확인) → 콘솔에서 **월 지출 한도** 설정 권장

### Claude API 키 (초안 작성 시)
`ANTHROPIC_API_KEY` — tistory-autopost와 같은 키 사용 가능. 초안은 Claude 대화에서 직접 써서 `queue/`에 넣어도 됨

## 2. 캠페인 등록 (`campaigns.csv`)
| 열 | 설명 |
|---|---|
| `name` | 캠페인 이름 (필수) |
| `url` | 애드픽 내 홍보 링크 (필수, 캠페인 상세 → 링크 복사) |
| `benefit` | 혜택 — **캠페인 상세 문구 그대로** (AI는 여기 적힌 것만 씀) |
| `target` | 대상·조건 (예: 만 19세 이상 신규) |
| `deadline` | 마감일 `YYYY-MM-DD` (지나면 초안 작성·게시 자동 제외) |
| `notes` | 금지 표현·강조점 등 AI 추가 지시 |
| `active` | `n` 이면 사용 안 함 |

- 양식: `campaigns.example.csv`
- **캠페인마다 홍보 허용 매체 확인 필수** — 애드픽 캠페인 상세에 SNS(트위터) 홍보 불가·키워드 광고 불가 등 조건이 있는 경우 있음. 위반 시 수익 취소 가능

## 3. 실행 (PC)
```bat
pip install -r requirements.txt
setx X_API_KEY "..."   (X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET 동일)
```
| 명령 | 동작 |
|---|---|
| `python x_poster.py --check` | 게시 방식 확인 (API: 계정 이름 / 알림: 테스트 알림 전송) |
| `python ai_tweet.py` | 대기열이 가장 적은 캠페인 1개 → 초안 3개 `queue/` 저장 |
| `python ai_tweet.py --campaign 카드 --variants 5` | 특정 캠페인 초안 5개 |
| `python ai_tweet.py --count 3 --dry-run` | 캠페인 3개, 저장 없이 확인 |
| `python x_poster.py --list` | 대기열·게시 가능 여부 확인 |
| `python x_poster.py` | 조건 맞는 글 1건 게시 |
| `python x_poster.py --manual` | 직접 실행: 간격 1/4로 완화·조용한 시간 무시 (24시간 최대 건수는 유지) |

### 대기열 파일 (`queue/*.json`)
```json
{"campaign": "예시 카드 발급", "url": "https://...", "text": "[광고] 본문...\nhttps://...",
 "publish_at": "2026-11-20 12:00", "deadline": "2026-12-31"}
```
- `text` 직접 수정 가능 (게시 직전에 다시 검사함). `publish_at` 비우면 오래된 순서대로
- 성공 → `queue/posted/` (트윗 ID 기록), 제외·실패 → `queue/failed/` (`fail_reason` 기록, 고친 뒤 `queue/`로 옮기면 재시도)

## 4. 자동 검사·제한
| 항목 | 내용 |
|---|---|
| 광고 표시 | 본문 첫머리에 `[광고]` 자동 삽입 (공정위 추천·보증 심사지침: 경제적 이해관계는 게시물 첫 부분에 표시). `config.json` → `disclosure` |
| 글자 수 | X 기준 280 (한글 1자=2, 링크 23) 초과 시 제외 |
| 과장 표현 | 무조건·100%·확정 수익 등 → 제외. AI 지시문에서 지어낸 후기·수치도 금지 |
| 링크·해시태그 | 링크 1개, 해시태그 3개 이하 |
| 게시 간격 | 1회 1건, 직전 게시 후 180분, 24시간 최대 3건 (`rate_limit`) |
| 캠페인 중복 | 같은 캠페인은 24시간 간격, 같은 문구는 다시 안 올림 |
| 조용한 시간 | 01~07시(KST) 게시 안 함 (`quiet_hours`) |
| 마감 | `deadline` 지난 글은 게시 안 함 |
| 오류 | 인증·한도 오류·알림 미설정 → 중단·알림 / X 거부(중복 등) → failed / 일시 오류 → 3회까지 재시도 |

설정 변경: `config.example.json` → `config.json` 복사 후 수정 (PC 전용, git 제외)

## 5. 휴대폰 실행 (GitHub Actions)
**Secret 등록**: 저장소 Settings → Secrets and variables → Actions

| Secret | 필요 |
|---|---|
| `NTFY_TOPIC` 또는 `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` | 무료 방식이면 필수 (tistory-autopost와 공용) |
| `ANTHROPIC_API_KEY` | 초안 작성 시 |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | 선택 (API 자동 게시) |

**실행**: Actions → **X 자동 게시 (애드픽)** → Run workflow
| mode | 동작 |
|---|---|
| 연결 점검 | Secret 등록 상태·계정 확인 |
| 초안 작성 | 초안만 `queue/`에 커밋 → GitHub 앱에서 검토·수정·삭제 |
| 초안 작성+게시 | 초안 작성 후 바로 1건 게시 |
| 게시 | 대기열에서 1건 게시 |
| 대기열 확인 | 게시 없이 상태표만 |

- 정기 실행: KST 09·12·15·18·21시 13분 → 조건 맞는 글 1건씩 게시/알림 (API 키·알림 모두 없으면 건너뜀)
- GitHub 정기 실행은 수십 분~몇 시간 늦을 수 있음 → 알림 시각도 그만큼 밀림
- 주의: 저장소가 공개라 `campaigns.csv`·`queue/` 내용(홍보 링크 포함)은 누구나 볼 수 있음

## 6. 테스트
```bat
pip install pytest
python -m pytest -q tests
```
