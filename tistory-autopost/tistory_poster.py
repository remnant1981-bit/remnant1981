"""
티스토리 자동 포스팅 프로그램 (Selenium 기반)

- Tistory Open API 종료(2024.02)로 브라우저 자동화 방식 사용
- 최초 1회 `--login` 으로 카카오 로그인 → 크롬 프로필에 세션 저장 → 이후 자동 실행

사용법:
  python tistory_poster.py --login              # 최초 로그인 (수동)
  python tistory_poster.py                      # posts/ 의 대기 글 업로드 (posts_per_run 개수)
  python tistory_poster.py --all                # 대기 글 전부 업로드
  python tistory_poster.py --file posts/a.md    # 특정 파일만 업로드
  python tistory_poster.py --dry-run            # 업로드 없이 파싱 결과만 확인
  python tistory_poster.py --daemon 09:00,18:00 # 매일 지정 시각 자동 업로드 (상주)
  python tistory_poster.py --export-cookies     # 로그인 쿠키 내보내기 (GitHub Actions/모바일 실행용)
  python tistory_poster.py --list               # 발행 대기·예약 글 목록

글 front matter 추가 항목:
  publish_at: 2026-11-05 09:00   예약 발행 (KST). 이 시각 전에는 --all 실행에서 건너뜀
  thumbnail_text: 썸네일 문구      대표 이미지 큰 글씨 (없으면 제목)
  thumbnail: images/a.png        직접 올린 이미지를 대표 이미지로 사용 ('none' = 썸네일 없음)

환경변수 (GitHub Actions 등 config.json 없는 환경):
  TISTORY_BLOG_NAME   블로그명 (config.json 의 blog_name 대체)
  TISTORY_COOKIES     --export-cookies 로 만든 문자열 (로그인 세션)
  TISTORY_HEADLESS=1  브라우저 숨김 실행
  KAKAO_ID / KAKAO_PW 카카오 계정 (쿠키 없거나 만료 시 자동 로그인, 휴대폰 카카오톡 승인 대기)
  KAKAO_APPROVE_WAIT  카카오톡 승인 대기 시간(초, 기본 180)
  TISTORY_SESSION_FILE 로그인 세션 저장 파일 (있으면 우선 사용, 로그인 성공 시 갱신 → 다음 실행 승인 생략)
"""

import argparse
import base64
import datetime as dt
import json
import logging
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import markdown

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"

VISIBILITY = {"public": "open20", "protected": "open15", "private": "open0"}
VISIBILITY_ALIAS = {"공개": "public", "보호": "protected", "비공개": "private"}

# 티스토리 에디터 UI 변경 시 이 부분만 수정
SEL = {
    "title": "#post-title-inp",
    "tag_input": "#tagText",
    "category_btn": "#category-btn",
    "category_item": "#category-list .mce-menu-item, #category-list [role='option']",
    "publish_layer_btn": "#publish-layer-btn",
    "publish_btn": "#publish-btn",
    "file_input": "input[type='file']",
    "attach_btn": "#mceu_0-open, button[aria-label*='첨부'], .mce-btn-attach, #attach-layer-btn",
}

log = logging.getLogger("tistory")


# ---------------------------------------------------------------- 설정/글 파싱
def load_config() -> dict:
    path = BASE_DIR / "config.json"
    if not path.exists():
        if not os.environ.get("TISTORY_BLOG_NAME"):
            shutil.copy(BASE_DIR / "config.example.json", path)
            sys.exit(f"[안내] config.json 생성됨 → blog_name 수정 후 재실행 필요: {path}")
        path = BASE_DIR / "config.example.json"  # CI: 기본값 + 환경변수
    cfg = json.loads(path.read_text(encoding="utf-8"))
    if os.environ.get("TISTORY_BLOG_NAME"):
        cfg["blog_name"] = os.environ["TISTORY_BLOG_NAME"].strip()
    if os.environ.get("TISTORY_HEADLESS"):
        cfg["headless"] = os.environ["TISTORY_HEADLESS"].lower() in ("1", "true", "yes")
    for k in ("chrome_profile_dir", "posts_dir", "published_dir", "failed_dir"):
        cfg[k] = (BASE_DIR / cfg[k]).resolve()
    if cfg.get("blog_name") in (None, "", "myblog"):
        sys.exit("[오류] config.json 의 blog_name 설정 필요 (예: https://abc.tistory.com → abc)")
    return cfg


@dataclass
class Post:
    path: Path
    title: str
    html: str
    category: str = ""
    tags: list = field(default_factory=list)
    visibility: str = "public"
    publish_at: "dt.datetime | None" = None   # 예약 발행 시각 (KST), None = 즉시
    thumbnail_text: str = ""                   # 썸네일 큰 문구 (없으면 제목)
    thumbnail: str = ""                        # 직접 지정한 이미지 경로, 'none' = 썸네일 없음


def tz(cfg: dict | None = None):
    from zoneinfo import ZoneInfo
    return ZoneInfo((cfg or {}).get("timezone", "Asia/Seoul"))


def parse_when(value: str, cfg: dict | None = None):
    """'2026-11-05 09:00' / '2026-11-05T09:00' → KST datetime"""
    v = (value or "").strip().replace("T", " ")
    if not v or v.lower() in ("now", "즉시"):
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(v, fmt).replace(tzinfo=tz(cfg))
        except ValueError:
            pass
    raise ValueError(f"publish_at 형식 오류: {value} (예: 2026-11-05 09:00)")


def now(cfg: dict | None = None):
    return dt.datetime.now(tz(cfg))


def parse_post(path: Path, cfg: dict) -> Post:
    """front matter(--- key: value ---) + 본문(.md 또는 .html) 파싱"""
    text = path.read_text(encoding="utf-8")
    meta, body = {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip()
        body = m.group(2)

    if path.suffix.lower() == ".md":
        html = markdown.markdown(body, extensions=["extra", "sane_lists", "nl2br"])
    else:
        html = body

    title = meta.get("title") or path.stem
    tags = [t.strip() for t in re.split(r"[,#]", meta.get("tags", "")) if t.strip()]
    vis = meta.get("visibility") or cfg.get("default_visibility", "public")
    vis = VISIBILITY_ALIAS.get(vis, vis).lower()
    if vis not in VISIBILITY:
        raise ValueError(f"visibility 값 오류: {vis} (public/protected/private)")
    return Post(path, title, html, meta.get("category") or cfg.get("default_category", ""), tags, vis,
                publish_at=parse_when(meta.get("publish_at", ""), cfg),
                thumbnail_text=meta.get("thumbnail_text", ""), thumbnail=meta.get("thumbnail", ""))


def pending_posts(cfg: dict, due_only: bool = True) -> list:
    """대기 글 목록. due_only=True 면 예약 시각이 지난 글(또는 예약 없는 글)만, 예약 시각 순"""
    files = [p for p in sorted(cfg["posts_dir"].iterdir())
             if p.is_file() and p.suffix.lower() in (".md", ".html", ".htm")]
    if not due_only:
        return files
    due, t = [], now(cfg)
    for f in files:
        try:
            when = parse_post(f, cfg).publish_at
        except Exception:
            when = None  # 파싱 오류는 run_once 에서 보고
        if when is None or when <= t:
            due.append((when or t, f))
    return [f for _, f in sorted(due, key=lambda x: x[0])]


def scheduled_posts(cfg: dict) -> list:
    """아직 시각이 안 된 예약 글 [(시각, 제목, 파일)]"""
    out, t = [], now(cfg)
    for f in pending_posts(cfg, due_only=False):
        try:
            p = parse_post(f, cfg)
        except Exception:
            continue
        if p.publish_at and p.publish_at > t:
            out.append((p.publish_at, p.title, f.name))
    return sorted(out)


# ---------------------------------------------------------------- 브라우저
class TistoryBot:
    def __init__(self, cfg: dict, headless: bool | None = None):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        self.cfg = cfg
        opts = Options()
        opts.add_argument(f"--user-data-dir={cfg['chrome_profile_dir']}")
        opts.add_argument("--window-size=1400,1000")
        opts.add_argument("--lang=ko-KR")
        opts.add_experimental_option("prefs", {"intl.accept_languages": "ko-KR,ko"})
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        if cfg.get("headless") if headless is None else headless:
            opts.add_argument("--headless=new")
            # 헤드리스 표시(HeadlessChrome) 제거한 일반 UA 사용
            opts.add_argument(
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        if os.environ.get("CI"):
            opts.add_argument("--no-sandbox")
            opts.add_argument("--disable-dev-shm-usage")
        # Selenium 4.6+ 내장 Selenium Manager 가 크롬드라이버 자동 설치
        self.d = webdriver.Chrome(options=opts)
        self.d.implicitly_wait(2)

    @property
    def manage_url(self):
        return f"https://{self.cfg['blog_name']}.tistory.com/manage"

    def close(self):
        try:
            self.d.quit()
        except Exception:
            pass

    # --- 공통 유틸
    def wait(self, css, timeout=15, clickable=False):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait
        cond = EC.element_to_be_clickable if clickable else EC.presence_of_element_located
        return WebDriverWait(self.d, timeout).until(cond((By.CSS_SELECTOR, css)))

    def dismiss_alert(self, accept=False):
        try:
            a = self.d.switch_to.alert
            log.info("알림창: %s", a.text)
            a.accept() if accept else a.dismiss()
            return True
        except Exception:
            return False

    # --- 쿠키 (모바일/클라우드 실행용 세션 이전)
    def export_cookies(self) -> str:
        self.d.get("https://www.tistory.com/")
        time.sleep(2)
        cookies = [c for c in self.d.get_cookies() if "tistory.com" in c.get("domain", "")]
        raw = json.dumps(cookies, ensure_ascii=False).encode("utf-8")
        return base64.b64encode(raw).decode("ascii")

    def import_cookies(self, encoded: str):
        cookies = json.loads(base64.b64decode(encoded.strip()))
        self.d.get("https://www.tistory.com/")
        for c in cookies:
            c = {k: v for k, v in c.items() if k in
                 ("name", "value", "domain", "path", "secure", "httpOnly", "expiry")}
            if "expiry" in c:
                c["expiry"] = int(c["expiry"])
            try:
                self.d.add_cookie(c)
            except Exception as e:
                log.debug("쿠키 추가 실패 %s: %s", c.get("name"), e)
        log.info("로그인 쿠키 %d개 적용", len(cookies))

    def _on_manage(self) -> bool:
        url = self.d.current_url
        return "/manage" in url and "login" not in url and "auth" not in url

    def _cookie_sources(self):
        """(이름, 쿠키문자열) 후보: 저장된 세션 → Secrets 쿠키 순"""
        out = []
        sf = os.environ.get("TISTORY_SESSION_FILE")
        if sf and Path(sf).is_file() and Path(sf).stat().st_size > 0:
            out.append(("저장된 세션", Path(sf).read_text(encoding="utf-8")))
        if os.environ.get("TISTORY_COOKIES"):
            out.append(("TISTORY_COOKIES", os.environ["TISTORY_COOKIES"]))
        return out

    def is_logged_in(self) -> bool:
        self.d.get(self.manage_url)
        time.sleep(3)
        if self._on_manage():
            return True
        if not getattr(self, "_cookies_tried", False):
            self._cookies_tried = True
            for name, cookies in self._cookie_sources():
                try:
                    self.d.delete_all_cookies()
                    self.import_cookies(cookies)
                except Exception as e:
                    log.warning("%s 적용 실패: %s", name, e)
                    continue
                self.d.get(self.manage_url)
                time.sleep(3)
                if self._on_manage():
                    log.info("로그인 성공 (%s)", name)
                    self.save_session()
                    return True
                log.info("%s 만료 → 다음 방법 시도", name)
        if os.environ.get("KAKAO_ID") and os.environ.get("KAKAO_PW") \
                and not getattr(self, "_kakao_tried", False):
            self._kakao_tried = True
            if self.kakao_login(os.environ["KAKAO_ID"], os.environ["KAKAO_PW"]):
                self.save_session()
                return True
        return False

    def save_session(self):
        sf = os.environ.get("TISTORY_SESSION_FILE")
        if not sf:
            return
        try:
            Path(sf).write_text(self.export_cookies(), encoding="utf-8")
            self.d.get(self.manage_url)
            log.info("로그인 세션 저장 (다음 실행부터 승인 생략 가능)")
        except Exception as e:
            log.warning("세션 저장 실패: %s", e)

    # --- 카카오 ID/PW 로그인 (클라우드 실행용)
    def kakao_login(self, kid: str, kpw: str) -> bool:
        from selenium.webdriver.common.by import By
        d = self.d
        log.info("카카오 계정 로그인 시도")
        d.get("https://www.tistory.com/auth/login")
        time.sleep(2)
        try:
            self.wait("a.link_kakao_id, a[class*='kakao']", timeout=10, clickable=True).click()
        except Exception:
            log.error("티스토리 로그인 화면에서 카카오 버튼 미발견")
            self._log_page()
            return False

        try:
            id_box = self.wait("input[name='loginId'], input#loginId--1, input[type='email']", timeout=15)
            pw_box = self.wait("input[name='password'], input[type='password']", timeout=5)
        except Exception:
            log.error("카카오 로그인 입력창 미발견")
            self._log_page()
            return False
        id_box.clear(); id_box.send_keys(kid)
        pw_box.clear(); pw_box.send_keys(kpw)
        time.sleep(0.5)
        d.find_element(By.CSS_SELECTOR, "button[type='submit'], button.submit").click()

        wait_sec = int(os.environ.get("KAKAO_APPROVE_WAIT", "180"))
        notified = False
        end = time.time() + wait_sec
        while time.time() < end:
            time.sleep(3)
            url = d.current_url
            if "tistory.com" in url and "auth/login" not in url and "kakao.com" not in url:
                d.get(self.manage_url)
                time.sleep(3)
                if self._on_manage():
                    log.info("카카오 로그인 성공")
                    return True
                break
            text = self._page_text()
            if any(k in text for k in ("보안문자", "자동입력 방지", "captcha")):
                log.error("카카오 보안문자(캡차) 요구 → 클라우드 로그인 불가. 쿠키 방식 사용 필요")
                return False
            if any(k in text for k in ("일치하지 않", "잘못", "does not match", "incorrect")) \
                    and "loginId" in d.page_source:
                log.error("카카오 로그인 실패: 아이디/비밀번호 확인 필요")
                self._log_page()
                return False
            if not notified and any(k in text for k in ("카카오톡", "인증", "승인", "KakaoTalk", "verif", "approve")):
                log.warning(">>> 휴대폰 카카오톡에서 로그인 승인 필요 (최대 %d초 대기) <<<", wait_sec)
                notified = True
            # 동의/계속 화면 자동 진행
            for el in d.find_elements(By.CSS_SELECTOR, "button, a"):
                try:
                    if el.is_displayed() and el.text.strip() in ("계속하기", "동의하고 계속하기"):
                        el.click()
                        break
                except Exception:
                    pass
        log.error("카카오 로그인 미완료 (승인 시간 초과 또는 추가 인증 필요)")
        self._log_page()
        return False

    def _page_text(self) -> str:
        try:
            return self.d.execute_script("return document.body ? document.body.innerText : ''") or ""
        except Exception:
            return ""

    def _log_page(self):
        # 스크린샷 대신 화면 문구만 기록 (계정 정보 노출 방지)
        log.info("현재 URL: %s", self.d.current_url.split("?")[0])
        log.info("화면 문구: %s", " ".join(self._page_text().split())[:300])

    # --- 로그인
    def manual_login(self):
        self.d.get("https://www.tistory.com/auth/login")
        print("\n브라우저에서 [카카오계정으로 로그인] 진행 (2단계 인증 포함).")
        print("로그인 완료 후 이 창에서 Enter 입력...")
        input()
        if self.is_logged_in():
            print("[완료] 로그인 세션 저장됨. 이후 자동 실행 가능.")
            # 같은 창에서 바로 쿠키 저장 (창을 닫으면 사라지는 세션 쿠키가 있어 별도 실행으로는 못 얻을 수 있음)
            out = BASE_DIR / "tistory_cookies.txt"
            out.write_text(self.export_cookies(), encoding="utf-8")
            print(f"[완료] 쿠키 파일 생성: {out}")
            print("→ 내용 전체를 GitHub Secret 'TISTORY_COOKIES' 에 등록 후 파일 삭제")
        else:
            print("[실패] 관리 페이지 접근 불가. 블로그명(blog_name) 또는 로그인 상태 확인 필요.")

    # --- 글 작성
    def publish(self, post: Post) -> str:
        d = self.d
        d.get(f"{self.manage_url}/newpost/")
        time.sleep(3)
        # '작성 중인 글이 있습니다. 이어서 작성?' → 취소(새 글)
        self.dismiss_alert(accept=False)

        self.wait("iframe, " + SEL["title"], timeout=20)
        # 에디터(TinyMCE) 준비 대기
        for _ in range(30):
            if d.execute_script("return !!(window.tinymce && tinymce.activeEditor)"):
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("에디터 로딩 실패")

        # 카테고리
        if post.category:
            self._select_category(post.category)

        # 제목
        title = self.wait(SEL["title"], clickable=True)
        title.clear()
        title.send_keys(post.title)

        # 썸네일: 에디터에 이미지 업로드 → 생성된 이미지 태그를 본문 맨 앞에 배치 (첫 이미지 = 대표 이미지)
        img_html = ""
        thumb = self._thumbnail_file(post)
        if thumb:
            img_html = self._upload_image(thumb)

        # 본문 (TinyMCE API 로 HTML 주입)
        d.execute_script(
            "tinymce.activeEditor.setContent(arguments[0]);"
            "tinymce.activeEditor.fire('change'); tinymce.activeEditor.save();",
            img_html + post.html,
        )
        time.sleep(1)

        # 태그
        if post.tags:
            from selenium.webdriver.common.keys import Keys
            tag = self.wait(SEL["tag_input"], clickable=True)
            for t in post.tags:
                tag.send_keys(t)
                tag.send_keys(Keys.ENTER)
                time.sleep(0.3)

        # 완료 → 공개범위 → 발행
        self.wait(SEL["publish_layer_btn"], clickable=True).click()
        time.sleep(1.5)
        vis_id = VISIBILITY[post.visibility]
        try:
            radio = self.wait(f"#{vis_id}", timeout=5)
            d.execute_script("arguments[0].click();", radio)
        except Exception:
            log.warning("공개범위 선택 실패 → 기본값으로 발행")
        time.sleep(0.5)
        self.wait(SEL["publish_btn"], clickable=True).click()

        # 발행 완료 대기 (글 목록/글 페이지로 이동)
        for _ in range(30):
            time.sleep(1)
            self.dismiss_alert(accept=True)
            if "/newpost" not in d.current_url:
                return d.current_url
        raise RuntimeError("발행 후 페이지 이동 미확인 (발행 여부 수동 확인 필요)")

    def _thumbnail_file(self, post: Post) -> "Path | None":
        tcfg = self.cfg.get("thumbnail", {})
        if post.thumbnail.lower() in ("none", "없음", "false"):
            return None
        if post.thumbnail:
            p = (post.path.parent / post.thumbnail).resolve()
            if not p.is_file():
                p = (BASE_DIR / post.thumbnail).resolve()
            if p.is_file():
                return p
            log.warning("지정한 썸네일 파일 없음: %s → 자동 생성", post.thumbnail)
        if not tcfg.get("enabled", True):
            return None
        try:
            import thumbnail as th
            out = LOG_DIR.parent / ".thumbs" / f"{post.path.stem}.png"
            footer = tcfg.get("footer") or f"{self.cfg['blog_name']}.tistory.com"
            return th.make_thumbnail(post.thumbnail_text or post.title, out, sub=post.category,
                                     footer=footer, font_path=tcfg.get("font", ""))
        except Exception as e:
            log.warning("썸네일 생성 실패 (썸네일 없이 발행): %s", e)
            return None

    def _upload_image(self, path: Path) -> str:
        """에디터 파일 입력란에 이미지 업로드 → 에디터에 삽입된 이미지 HTML 반환. 실패 시 '' (글은 그대로 발행)"""
        from selenium.webdriver.common.by import By
        d = self.d
        try:
            d.execute_script("tinymce.activeEditor.setContent('');")
            inputs = d.find_elements(By.CSS_SELECTOR, SEL["file_input"])
            if not inputs:
                for css in SEL["attach_btn"].split(","):
                    for b in d.find_elements(By.CSS_SELECTOR, css.strip()):
                        try:
                            if b.is_displayed():
                                b.click()
                                time.sleep(0.8)
                                break
                        except Exception:
                            pass
                inputs = d.find_elements(By.CSS_SELECTOR, SEL["file_input"])
            if not inputs:
                log.warning("이미지 업로드 입력란 미발견 → 썸네일 없이 발행 (SEL['file_input'] 확인 필요)")
                return ""
            imgs = [i for i in inputs if "image" in (i.get_attribute("accept") or "")] or inputs
            imgs[0].send_keys(str(path))
            for _ in range(40):
                time.sleep(0.5)
                html = d.execute_script("return tinymce.activeEditor.getContent();") or ""
                if "<img" in html or "[##_Image" in html:
                    log.info("썸네일 업로드 완료")
                    return html
            log.warning("썸네일 업로드 시간 초과 → 썸네일 없이 발행")
        except Exception as e:
            log.warning("썸네일 업로드 실패 (썸네일 없이 발행): %s", e)
        try:
            d.find_element(By.TAG_NAME, "body").send_keys("\ue00c")  # ESC: 열린 메뉴 닫기
        except Exception:
            pass
        return ""

    def _select_category(self, name: str):
        from selenium.webdriver.common.by import By
        try:
            self.wait(SEL["category_btn"], clickable=True).click()
            time.sleep(0.8)
            for el in self.d.find_elements(By.CSS_SELECTOR, SEL["category_item"]):
                if el.text.strip().lstrip("-").strip() == name:
                    el.click()
                    return
            log.warning("카테고리 '%s' 없음 → 카테고리 없음으로 발행", name)
            self.d.find_element(By.TAG_NAME, "body").click()
        except Exception as e:
            log.warning("카테고리 선택 실패: %s", e)


# ---------------------------------------------------------------- 실행 흐름
def move(path: Path, dst_dir: Path):
    dst_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.move(str(path), str(dst_dir / f"{stamp}_{path.name}"))


def notify(title: str, msg: str, priority: str = "default"):
    """휴대폰 푸시 알림 (NTFY_TOPIC 또는 TELEGRAM_* 설정 시)"""
    try:
        import notify as nt
        nt.send(title, msg, priority=priority)
    except Exception as e:
        log.debug("알림 실패: %s", e)


def summary(lines: list):
    """GitHub Actions 실행 화면 요약 (휴대폰 앱에서 확인)"""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def summary_schedule(cfg: dict):
    rows = scheduled_posts(cfg)
    if rows:
        summary(["### ⏰ 예약 대기", "| 발행 예정 (KST) | 제목 |", "|---|---|",
                 *[f"| {w:%Y-%m-%d %H:%M} | {t} |" for w, t, _ in rows]])


def run_once(cfg: dict, files: list, dry_run=False) -> int:
    if not files:
        log.info("발행할 글 없음 (%s)", cfg["posts_dir"])
        for w, t, _ in scheduled_posts(cfg):
            log.info("  예약 대기: %s  %s", f"{w:%Y-%m-%d %H:%M}", t)
        summary_schedule(cfg)
        return 0
    posts = []
    for f in files:
        try:
            posts.append(parse_post(f, cfg))
        except Exception as e:
            log.error("파싱 실패 %s: %s", f.name, e)
    if dry_run:
        for p in posts:
            when = f"{p.publish_at:%Y-%m-%d %H:%M}" if p.publish_at else "즉시"
            log.info("[DRY] %s | 제목=%s | 카테고리=%s | 태그=%s | 공개=%s | 발행=%s | 본문 %d자",
                     p.path.name, p.title, p.category or "-", p.tags, p.visibility, when, len(p.html))
        return len(posts)

    bot = TistoryBot(cfg)
    ok = 0
    results = []
    try:
        if not bot.is_logged_in():
            notify("티스토리 로그인 실패", "세션 만료 또는 승인 필요 → 로그인 점검 실행", "high")
            if os.environ.get("GITHUB_EVENT_NAME") == "schedule":
                summary(["### ❌ 예약 발행 실패: 저장된 로그인 세션 만료",
                         "- Run workflow → mode `로그인 점검` 실행 후 카카오톡 승인 → 다음 정시 점검에서 자동 발행"])
            else:
                summary(["### ❌ 티스토리 로그인 실패",
                         "- 카카오톡 승인 시간 초과, 비밀번호 오류, 보안문자 요구 중 하나 → 실행 로그 확인"])
            log.error("로그인 필요 → `python tistory_poster.py --login` 먼저 실행"
                      " (클라우드 실행 시 KAKAO_ID/KAKAO_PW 또는 TISTORY_COOKIES 확인)")
            return 0
        for i, p in enumerate(posts):
            try:
                url = bot.publish(p)
                log.info("[성공] %s → %s", p.title, url)
                move(p.path, cfg["published_dir"])
                ok += 1
                results.append(f"| ✅ | {p.title} | {p.visibility} |")
            except Exception as e:
                log.exception("[실패] %s: %s", p.title, e)
                LOG_DIR.mkdir(exist_ok=True)
                try:
                    bot.d.save_screenshot(str(LOG_DIR / f"error_{p.path.stem}.png"))
                except Exception:
                    pass
                move(p.path, cfg["failed_dir"])
                results.append(f"| ❌ | {p.title} | {str(e).splitlines()[0][:80] if str(e) else type(e).__name__} |")
            if i < len(posts) - 1:
                time.sleep(cfg.get("wait_between_posts_sec", 30))
    finally:
        bot.close()
    log.info("결과: %d/%d 건 발행", ok, len(posts))
    if results:
        summary([f"### 티스토리 발행 결과: {ok}/{len(posts)}건",
                  "| 결과 | 제목 | 공개범위/오류 |", "|---|---|---|", *results,
                  f"\n[블로그 글 관리 열기](https://{cfg['blog_name']}.tistory.com/manage/posts/)"])
    summary_schedule(cfg)
    if results:
        notify(f"티스토리 발행 {ok}/{len(posts)}건",
               "\n".join(r.split("|")[1].strip() + " " + r.split("|")[2].strip() for r in results),
               "default" if ok == len(posts) else "high")
    return ok


def daemon(cfg: dict, times: list):
    log.info("상주 모드 시작: 매일 %s", ", ".join(times))
    done = set()
    while True:
        now = dt.datetime.now()
        key = now.strftime("%Y-%m-%d %H:%M")
        if now.strftime("%H:%M") in times and key not in done:
            done.add(key)
            run_once(cfg, pending_posts(cfg)[: cfg.get("posts_per_run", 1)])
        time.sleep(20)


def setup_logging():
    LOG_DIR.mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(LOG_DIR / "tistory.log", encoding="utf-8")],
    )


def main():
    ap = argparse.ArgumentParser(description="티스토리 자동 포스팅")
    ap.add_argument("--login", action="store_true", help="최초 수동 로그인")
    ap.add_argument("--all", action="store_true", help="대기 글 전부 발행")
    ap.add_argument("--file", help="특정 파일만 발행")
    ap.add_argument("--dry-run", action="store_true", help="발행 없이 파싱만 확인")
    ap.add_argument("--daemon", help="매일 발행 시각, 예: 09:00,18:00")
    ap.add_argument("--export-cookies", action="store_true", help="로그인 쿠키 내보내기 (모바일 실행용)")
    ap.add_argument("--check", action="store_true", help="로그인만 점검 (발행 안 함)")
    ap.add_argument("--list", action="store_true", help="대기·예약 글 목록만 출력")
    ap.add_argument("--due", action="store_true", help="발행 시각이 된 글이 있으면 0, 없으면 3 으로 종료 (자동 실행 판단용)")
    args = ap.parse_args()

    setup_logging()
    cfg = load_config()
    cfg["posts_dir"].mkdir(parents=True, exist_ok=True)

    if args.login:
        bot = TistoryBot(cfg, headless=False)
        try:
            bot.manual_login()
        finally:
            bot.close()
        return
    if args.export_cookies:
        bot = TistoryBot(cfg)
        try:
            if not bot.is_logged_in():
                sys.exit("[오류] 로그인 상태 아님 → --login 먼저 실행")
            out = BASE_DIR / "tistory_cookies.txt"
            out.write_text(bot.export_cookies(), encoding="utf-8")
            print(f"[완료] {out} 생성")
            print("→ 파일 내용 전체를 GitHub Secrets 'TISTORY_COOKIES' 에 등록 (외부 유출 금지, 등록 후 파일 삭제 권장)")
        finally:
            bot.close()
        return
    if args.due:
        sys.exit(0 if pending_posts(cfg) else 3)
    if args.list:
        for f in pending_posts(cfg):
            print(f"[발행 대기] {f.name}")
        for w, t, f in scheduled_posts(cfg):
            print(f"[예약 {w:%Y-%m-%d %H:%M}] {t}  ({f})")
        return
    if args.check:
        bot = TistoryBot(cfg)
        try:
            ok = bot.is_logged_in()
        finally:
            bot.close()
        if ok:
            log.info("[점검 완료] 로그인 정상 → 발행 가능")
            summary(["### ✅ 로그인 점검 정상", f"- 블로그: {cfg['blog_name']}.tistory.com", "- 이제 글 작성·발행 실행 가능"])
        else:
            summary(["### ❌ 로그인 점검 실패", "- 실행 로그의 오류 문구 확인"])
            sys.exit(1)
        return
    if args.daemon:
        daemon(cfg, [t.strip() for t in args.daemon.split(",")])
        return

    if args.file:
        files = [Path(args.file).resolve()]
    else:
        files = pending_posts(cfg)
        if not args.all:
            files = files[: cfg.get("posts_per_run", 1)]
    ok = run_once(cfg, files, dry_run=args.dry_run)
    if os.environ.get("CI") and files and not args.dry_run and ok < len(files):
        sys.exit(1)


if __name__ == "__main__":
    main()
