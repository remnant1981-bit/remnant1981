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
