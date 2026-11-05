# 티스토리 자동 포스팅 (tistory-autopost)

`posts/` 폴더에 마크다운(.md)/HTML 파일을 넣으면 티스토리에 자동 발행함.
Tistory Open API 종료(2024.02)로 **Selenium 브라우저 자동화** 방식 사용.

## 1. 설치
```bat
pip install -r requirements.txt
```
- Chrome 설치 필요. 크롬드라이버는 Selenium Manager가 자동 설치.

## 2. 설정
1. 최초 실행 시 `config.json` 자동 생성 → `blog_name` 수정 (`https://abc.tistory.com` → `abc`)
2. 최초 1회 로그인 (카카오 2단계 인증 때문에 수동)
```bat
python tistory_poster.py --login
```
→ 브라우저에서 카카오 로그인 후 콘솔에서 Enter. 세션은 `chrome_profile/`에 저장됨.

| 항목 | 설명 |
|---|---|
| `default_category` | 기본 카테고리명 (빈 값 = 카테고리 없음) |
| `default_visibility` | `public` / `protected` / `private` |
| `posts_per_run` | 1회 실행 시 발행 개수 |
| `headless` | 브라우저 숨김 실행 (로그인 안정화 후 `true` 권장) |
| `wait_between_posts_sec` | 연속 발행 간격(초) |

## 3. 글 작성 형식 (`posts/*.md`)
```markdown
---
title: 글 제목
category: 카테고리명
tags: 태그1, 태그2, 태그3
visibility: public
---

본문 (마크다운 또는 HTML)
```
- 예시: `sample_post.example.md`, `examples/example_ai_post.md`(AI 작성 결과 예시), `examples/preview.html`(발행 모양 미리보기) 참고
- 파일명 순서대로 발행 → `01_xxx.md`, `02_xxx.md` 식 명명 권장
- 성공 → `posts/published/`, 실패 → `posts/failed/` 이동 (실패 스크린샷: `logs/`)

## 4. 실행
| 명령 | 동작 |
|---|---|
| `python tistory_poster.py` | 대기 글 `posts_per_run`개 발행 |
| `python tistory_poster.py --all` | 대기 글 전부 발행 |
| `python tistory_poster.py --file posts/a.md` | 특정 파일 발행 |
| `python tistory_poster.py --dry-run --all` | 발행 없이 파싱 결과 확인 |
| `python tistory_poster.py --daemon 09:00,18:00` | 매일 지정 시각 자동 발행 (상주) |

- Windows: `run_tistory.bat` 더블클릭 또는 **작업 스케줄러**에 등록 (상주 불필요, 권장)

## 5. 주의사항
- 티스토리 에디터 UI 변경 시 `tistory_poster.py` 상단 `SEL` 선택자 수정 필요
- 로그인 세션 만료 시 `--login` 재실행
- 과도한 연속 발행은 스팸 판정 위험 → 하루 1~3건 수준 권장
- `config.json`, `chrome_profile/`은 개인정보 포함 → git 제외 처리됨

## 6. AI 본문 자동 작성 (Claude API)
주제만 입력 → Claude가 제목·태그·본문 작성 → `posts/`에 .md 저장 → 위 발행 흐름 그대로 사용.

1. API 키 발급: https://console.anthropic.com → 환경변수 설정
```bat
setx ANTHROPIC_API_KEY "sk-ant-..."
```
2. 실행
| 명령 | 동작 |
|---|---|
| `python ai_writer.py "주제1" "주제2"` | 주제별 글 작성 → `posts/` 저장 |
| `python ai_writer.py --topics-file topics.txt --count 3` | 주제 목록에서 3건 작성 (완료 주제는 파일에서 삭제) |
| `python ai_writer.py "주제" --extra "초보자 대상, 코드 예시 포함"` | 추가 요청 반영 |
| `python ai_writer.py "주제" --category IT --visibility private` | 카테고리·공개범위 지정 |
| `python ai_writer.py "주제" --publish` | 작성 직후 바로 발행 |

3. `config.json`의 `ai` 항목
| 항목 | 설명 |
|---|---|
| `model` | 기본 `claude-opus-5-5` |
| `effort` | `low` / `medium` / `high` (높을수록 품질↑·비용↑) |
| `min_chars` | 최소 본문 분량(자) |
| `title_candidates` | 제목 후보 수 (기본 8, 자동 점수로 최선 선택) |
| `quality_gate` | 문체 검사 후 문제 있으면 1회 자동 수정 (기본 켜짐) |
| `self_check` | 15개 항목 자체 점검, 정직성 미달 시 비공개 보류 (기본 켜짐) |
| `sns` | Threads용 글·3줄 요약 생성 (기본 켜짐) |
| `style_prompt` | 블로그별 추가 지시 (예: `R&D 실무자 대상, 합니다체`) |

### 글 품질 관리 (Uplika 스킬 기반)
[Uplika 플러그인](https://github.com/uplika/uplika-plugin)(MIT)의 블로그·SNS 스킬을 티스토리용으로 가져옴. 원본은 `vendor/uplika/`, 출처·라이선스는 `vendor/uplika/README.md`

| 기능 | 내용 | 출처 스킬 |
|---|---|---|
| 한국어 문체 규칙 | 어미 통일, 번역투·강조어 금지, 상황으로 독자 호칭, 실제 숫자만 | hooks |
| 정직성 규칙 | 지어낸 1인칭 경험·출처 없는 수치·가짜 내돈내산 금지, 사진 자리표시 금지 | naver-ai-cite |
| 글 구조 | 독자·상황 → 결론 → 절차·팁 → 상황별 비교표 → 결과·한계 → 근거 → 요약·FAQ | naver-ai-cite (네이버 공식 가이드) |
| 도입부 훅 19종 | 최근 5개 글에서 쓴 패턴은 자동으로 피함 | hooks |
| 제목 자동 선택 | 후보 8개 → 길이(한글 40자)·강조어·숫자 유무 등 점수화 → 최고점 채택 | yt-package `title.py` |
| 문체 검사 | 강조어·번역투·어미 혼용·사진 자리표시·문장 길이 단조로움 → 문제 시 자동 수정 | ig-human, threads |
| 15개 자체 점검 | 네이버 AI 브리핑 가이드 원칙 5·셀프체크 5·주의 5를 pass/gap/na로 판정 | naver-ai-cite |
| 문체 프로필 | `voice.md` 작성 시 최우선 적용 (`voice.example.md` 양식) | voice-profile |
| 키워드 중복 방지 | 글마다 핵심·보조 키워드 기록, 이미 다룬 핵심 키워드 회피 | naver-keywords |
| SNS 재가공 | Threads용 글·3줄 요약 생성 → Actions 요약 화면·`sns/` 폴더 | repurpose, threads |

- 자동 수정·자체 점검 때문에 글 1건당 API 호출 2~3회 → 비용도 약 2~3배. 줄이려면 `quality_gate`/`self_check`를 `false`로
- 발행 이력은 `history.jsonl`에 기록 (제목·핵심 키워드·훅 패턴). 저장소가 공개면 이 내용도 공개됨
- SNS 자동 게시는 Uplika 서버(비공개) 연동이 필요 → Claude 앱에 Uplika 커넥터(`https://api.uplika.com/mcp`) 추가 후 "이 글 Threads에 올려 줘"로 게시

## 7. 모바일 실행 (GitHub Actions)
PC 없이 휴대폰 GitHub 앱에서 실행 → GitHub 클라우드에서 AI 작성 + 발행.

### 최초 1회 설정
**로그인은 쿠키 방식 (PC 1회 필요)** — 카카오가 클라우드 서버(GitHub Actions 포함) 접속을 "네트워크 정보가 변경되었거나 올바르지 않은 접근"으로 차단하는 것을 확인함 (2026-11 실측). 그래서 PC에서 한 번 로그인해 쿠키를 넘김.

1. PC(Windows)에 Python 설치 — python.org, 설치 화면에서 **Add python.exe to PATH** 체크 / Chrome 설치되어 있어야 함
2. 저장소 페이지 → Code → **Download ZIP** → 압축 해제
3. 명령 프롬프트에서 `tistory-autopost` 폴더로 이동 후:
```bat
pip install -r requirements.txt
python tistory_poster.py --login
```
   - 첫 실행은 `config.json`만 만들고 종료 → 메모장으로 열어 `"blog_name": "블로그명"` 수정 후 다시 `--login`
   - 열린 Chrome 창에서 카카오 로그인 → 콘솔에서 Enter
4. `python tistory_poster.py --export-cookies` → 생성된 `tistory_cookies.txt` 내용 전체 복사 → 아래 Secret에 붙여넣기 → **파일 삭제**

**Secret 등록**: github.com → 저장소 → Settings → Secrets and variables → Actions → New repository secret
(GitHub 앱에는 이 메뉴 없음 → 브라우저 사용, 휴대폰이면 "데스크톱 사이트" 전환)

| Secret 이름 | 값 | 필요 |
|---|---|---|
| `TISTORY_BLOG_NAME` | 블로그명 (`abc.tistory.com` → `abc`) | 필수 |
| `TISTORY_COOKIES` | `tistory_cookies.txt` 내용 | 필수 |
| `SESSION_KEY` | 아무 긴 무작위 문자열 (로그인 세션 자동 갱신·암호화 저장용) | 권장 |
| `ANTHROPIC_API_KEY` | Claude API 키 | 선택 (Actions에서 AI 글 작성할 때만. Claude 대화에서 글을 쓰면 불필요) |
| `KAKAO_ID` / `KAKAO_PW` | — | **비추천** (클라우드 접속 차단으로 실패 가능성 높음, 공개 저장소에 비밀번호 보관 불필요) |

- 쿠키가 만료되면 Summary에 로그인 실패 안내 → PC에서 3~4번만 다시 실행해 `TISTORY_COOKIES` 갱신
- `SESSION_KEY`를 등록하면 실행 중 갱신된 세션이 암호화 저장돼 쿠키 수명이 길어짐

### 휴대폰에서 실행 (순서대로)
**① 설정 점검 (최초 1회)** — 글은 올리지 않고 로그인만 확인
- GitHub 앱 → 저장소 → Actions → **티스토리 자동 포스팅** → Run workflow → mode `로그인 점검` → Run
- 카카오톡 로그인 승인 알림 → 승인
- 실행 화면 하단 Summary에 Secret 등록 상태·로그인 결과 표시
- 성공 시 로그인 세션이 암호화 저장됨 → **다음 실행부터 카카오톡 승인 생략** (세션 만료 시에만 다시 승인)

**② 바로 발행** — Run workflow → mode `작성+발행` → 입력 후 Run

| 항목 | 설명 |
|---|---|
| topic | AI가 쓸 주제 (비우면 `topics.txt` 사용) |
| count | `topics.txt`에서 작성할 개수 (0 = 사용 안 함) |
| visibility | 공개 범위 (기본 private) |
| extra | 추가 요청사항 |

**③ 주제 커밋만으로 자동 발행** — Run workflow 버튼 없이 사용
- GitHub 앱에서 `tistory-autopost/topics.txt` 편집 → 주제 줄 추가 → Commit → 자동 실행 (1회 최대 3건)
- `tistory-autopost/posts/`에 직접 쓴 .md 업로드·커밋 → 자동 발행
- 이 경우 공개범위 기본값은 `private` → 바꾸려면 Settings → Secrets and variables → Actions → **Variables** 탭 → `DEFAULT_VISIBILITY` = `public`

**결과 확인**: Actions 실행 화면 Summary에 발행 결과표(제목·성공/실패) + 블로그 글 관리 링크 표시

- 매일 자동: `.github/workflows/tistory-autopost.yml`의 `schedule` 주석 해제
- 세션 암호화 키: Secret `SESSION_KEY` (미등록 시 `KAKAO_PW`, 둘 다 없으면 세션 저장 안 함)

### 주의
- 저장소가 **공개** 상태면 `topics.txt`, `posts/` 내용도 공개됨 → 비공개 저장소 전환 권장 (Secrets는 공개 저장소여도 암호화 보관)
- **공개 저장소 운영 기준**: Secret은 공개 저장소에서도 암호화 보관되고 외부 PR에는 전달되지 않음. 단, `posts/`의 예약 원고·`topics.txt`·`history.jsonl`은 누구나 볼 수 있음
- 비공개로 바꾸면 무료 계정에서는 GitHub Pages(쿠폰 지갑, 서치콘솔 소유확인 파일)가 꺼지고 Actions 월 2,000분 한도가 생김
- 로그인 순서: 저장된 세션 → `TISTORY_COOKIES` → 카카오 ID/PW (승인 필요)
- 카카오 비밀번호 변경 시 저장된 세션 해독 불가 → 다음 실행에서 한 번 더 승인하면 자동 갱신
- 발행 실패 시 Actions 실행 화면 → Artifacts `tistory-logs`에서 오류 스크린샷 확인 (3일 보관, 로그인 실패는 계정 노출 방지로 화면 문구만 로그에 기록)

## 8. 예약 발행
글에 발행 시각을 넣어 두면 GitHub Actions가 **매시 7분** 자동 점검 → 시각이 지난 글만 발행.

| 방법 | 설정 |
|---|---|
| 휴대폰 실행 시 | Run workflow → `publish_at` 칸에 `auto` (빈 시간대 자동 배정) 또는 `2026-11-05 09:00` |
| 주제 커밋 자동 실행 시 | 저장소 Settings → Secrets and variables → Actions → Variables → `DEFAULT_PUBLISH_AT` = `auto` |
| 직접 쓴 글 | front matter 에 `publish_at: 2026-11-05 09:00` |
| PC | `python ai_writer.py "주제" --publish-at auto` |

- 자동 배정 시간대: Variables `SCHEDULE_SLOTS` = `09:00,19:00` (기본 `09:00`). 이미 예약된 칸은 건너뜀
- 지정 시각으로 여러 글 작성 시 24시간 간격으로 배정 (`config.json` → `schedule.gap_hours`)
- 주말 제외 (PC): `config.json` → `schedule.skip_weekdays: [5, 6]`
- 예약 대기 목록: 실행 화면 Summary ⏰ 표, 또는 `python tistory_poster.py --list`
- 시각은 한국시간(KST). **GitHub 정기 실행은 이용자가 적은 저장소에서 몇 시간씩 늦거나 건너뛸 수 있음** (실측: 매시 설정인데 6~8시간 간격 실행) → 정확한 시각이 중요하면 아래 '정기 실행 보강' 참고
- 매시 점검은 **저장된 로그인 세션만 사용** (카카오톡 승인 불가) → 세션 만료 시 Summary에 안내가 뜨면 `로그인 점검` 1회 실행
- 예약 글은 발행 전까지 저장소 `posts/`에 보관됨 → 공개 저장소라 미리 보임 (민감한 글은 예약 대신 바로 발행)
- 발행 실패 글은 `posts/failed/`에 보관 → 다시 시도하려면 GitHub 앱에서 `posts/`로 이동
- 비공개 저장소의 Actions 무료 한도(월 2,000분) 중 매시 점검이 월 약 720분 사용

## 9. 썸네일 (대표 이미지)
발행할 때 1200×630 썸네일을 자동 생성해 본문 맨 앞에 업로드 → 첫 이미지가 대표 이미지로 쓰임.

- 큰 글씨: front matter `thumbnail_text` (AI가 제목과 다른 14자 안팎 문구로 작성), 없으면 제목
- 작은 글씨: 카테고리 / 하단: 블로그 주소 (`config.json` → `thumbnail.footer` 로 변경)
- 색상: 카테고리별로 고정 (같은 카테고리 = 같은 색)
- 직접 만든 이미지 사용: 이미지를 `posts/images/`에 올리고 front matter `thumbnail: images/파일명.png`
- 썸네일 끄기: 글마다 `thumbnail: none`, 전체는 `config.json` → `thumbnail.enabled: false`
- 한글 폰트: 시스템 폰트(맑은 고딕 등) 우선, 없으면 나눔고딕(OFL) 자동 다운로드 → `fonts/`
- 미리 보기: `python thumbnail.py "문구" --sub "카테고리" -o test.png`
- 업로드가 실패해도 글은 썸네일 없이 발행됨 (실행 로그에 경고). 에디터 화면이 바뀌면 `tistory_poster.py` 상단 `SEL["file_input"]`, `SEL["attach_btn"]` 수정

## 10. 주간 점검 (성과 리포트 · 댓글 정리 · 오래된 글 점검)
매주 **월요일 09:23 (KST)** 자동 실행, 또는 Run workflow → mode `주간 점검` / `성과 리포트` / `댓글 정리` / `오래된 글 점검`.
결과는 실행 화면 Summary에 표시. **아무것도 자동으로 게시·수정하지 않음** (Uplika 방식: 사람이 확인 후 반영).

| 기능 | 하는 일 | 필요한 것 |
|---|---|---|
| 성과 리포트 | 티스토리 통계 화면 + 발행 이력 → 잘된 글·아쉬운 글, 차이점, 다음 주 할 일, 글감 제안 | 로그인 세션 (없으면 공개 정보만) |
| 댓글 정리 | 새 댓글을 💬답변 / 🚫숨김 / 💡글감 / ➖무시로 분류 + 답글 초안 | 로그인 세션 |
| 오래된 글 점검 | 180일 넘게 수정 안 한 글 5개씩 → 바뀌었을 수 있는 가격·날짜·버전·제도 찾고 수정안 | 없음 (공개 사이트맵) |

- 글감 제안은 `topics.txt`에 `# 주제` 주석으로 추가됨 → 휴대폰에서 줄 앞 `# `만 지우고 커밋하면 자동 작성
- 답글 초안은 티스토리 앱 → 댓글 관리에서 붙여 넣어 사용
- 오래된 글 점검은 매주 다른 글 5개 (같은 글은 90일 후 재점검, 이력 `refresh_state.json`)
- 성과 분석 규칙: 이 블로그 자체 중앙값과 비교, 없는 수치는 '데이터 없음', 글 1개 결과로 패턴 단정 안 함
- 통계·댓글은 관리 화면 글자를 그대로 읽어 Claude가 정리 → 화면 구조가 바뀌어도 대부분 동작
- 자동 실행은 저장된 로그인 세션만 사용 → 세션 만료 시 통계·댓글은 건너뛰고 오래된 글 점검만 진행
- 주간 점검 1회 API 호출 3회 (리포트·댓글·갱신 각 1회)

## 11. 휴대폰 푸시 알림 (선택)
발행 결과·로그인 실패·주간 점검 결과를 휴대폰 알림으로 받기. 설정 안 하면 알림 없음 (GitHub 앱 실패 알림은 기본 제공).

**ntfy (가입 불필요, 추천)**
1. 휴대폰에 ntfy 앱 설치 → `+` → 남이 못 맞힐 주제 이름 입력 (예: `hooni-blog-8f3k2`)
2. Secret `NTFY_TOPIC` = 같은 주제 이름
- 주제 이름을 아는 사람은 누구나 알림을 볼 수 있음 → 길고 무작위로

**텔레그램**
1. @BotFather 로 봇 생성 → 토큰 → Secret `TELEGRAM_BOT_TOKEN`
2. 봇에게 아무 메시지 전송 후 `https://api.telegram.org/bot<토큰>/getUpdates`에서 chat id 확인 → Secret `TELEGRAM_CHAT_ID`

테스트: `python notify.py "제목" "내용"`

### 정기 실행 보강 (선택)
GitHub 정기 실행이 늦을 때, 외부 무료 스케줄러로 매시간 실행 버튼을 대신 누르게 할 수 있음.
1. GitHub → Settings(개인) → Developer settings → Fine-grained tokens → 이 저장소만, 권한 `Actions: Read and write` 로 토큰 생성
2. cron-job.org 등에서 매시 실행 작업 생성
   - URL: `https://api.github.com/repos/<소유자>/<저장소>/actions/workflows/tistory-autopost.yml/dispatches`
   - Method: POST, Header: `Authorization: Bearer <토큰>`, `Accept: application/vnd.github+json`
   - Body: `{"ref":"main","inputs":{"mode":"작성+발행","count":"0"}}`
   - `count: 0` → 새 글은 쓰지 않고 시각이 된 예약 글만 발행
- 토큰은 외부 서비스에 저장되므로 이 저장소·Actions 권한만 주고, 만료일을 정해 둘 것

## 12. 구글 서치콘솔 (검색 노출)
- 티스토리 블로그: 루트에 파일을 올릴 수 없어 **HTML 태그 방식**으로 소유 확인
  - 서치콘솔 → 속성 추가 → URL 접두어 `https://블로그명.tistory.com/` → 확인 방법 **HTML 태그** → `<meta name="google-site-verification" ...>` 복사
  - 티스토리 관리 → 플러그인 → **메타 태그 등록** 또는 꾸미기 → 스킨 편집 → HTML의 `<head>` 안에 붙여넣기 → 서치콘솔에서 확인
  - 확인 후 **Sitemaps** 메뉴에 `sitemap.xml` 제출, RSS(`rss`)도 추가 제출 가능
- 파일 방식(`googleXXXX.html`)은 GitHub Pages 사이트용 → `coupon-wallet/` 폴더에 넣으면 `https://<소유자>.github.io/<저장소>/googleXXXX.html` 로 배포됨
