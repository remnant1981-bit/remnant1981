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
"""

import argparse
import datetime as dt
import json
import logging
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
}

log = logging.getLogger("tistory")


# ---------------------------------------------------------------- 설정/글 파싱
def load_config() -> dict:
    path = BASE_DIR / "config.json"
    if not path.exists():
        shutil.copy(BASE_DIR / "config.example.json", path)
        sys.exit(f"[안내] config.json 생성됨 → blog_name 수정 후 재실행 필요: {path}")
    cfg = json.loads(path.read_text(encoding="utf-8"))
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
    return Post(path, title, html, meta.get("category") or cfg.get("default_category", ""), tags, vis)


def pending_posts(cfg: dict) -> list:
    files = [p for p in sorted(cfg["posts_dir"].iterdir())
             if p.is_file() and p.suffix.lower() in (".md", ".html", ".htm")]
    return files


# ---------------------------------------------------------------- 브라우저
class TistoryBot:
    def __init__(self, cfg: dict, headless: bool | None = None):
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        self.cfg = cfg
        opts = Options()
        opts.add_argument(f"--user-data-dir={cfg['chrome_profile_dir']}")
        opts.add_argument("--window-size=1400,1000")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        if cfg.get("headless") if headless is None else headless:
            opts.add_argument("--headless=new")
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

    def is_logged_in(self) -> bool:
        self.d.get(self.manage_url)
        time.sleep(3)
        url = self.d.current_url
        return "/manage" in url and "login" not in url and "auth" not in url

    # --- 로그인
    def manual_login(self):
        self.d.get("https://www.tistory.com/auth/login")
        print("\n브라우저에서 [카카오계정으로 로그인] 진행 (2단계 인증 포함).")
        print("로그인 완료 후 이 창에서 Enter 입력...")
        input()
        if self.is_logged_in():
            print("[완료] 로그인 세션 저장됨. 이후 자동 실행 가능.")
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

        # 본문 (TinyMCE API 로 HTML 주입)
        d.execute_script(
            "tinymce.activeEditor.setContent(arguments[0]);"
            "tinymce.activeEditor.fire('change'); tinymce.activeEditor.save();",
            post.html,
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


def run_once(cfg: dict, files: list, dry_run=False) -> int:
    if not files:
        log.info("대기 중인 글 없음 (%s)", cfg["posts_dir"])
        return 0
    posts = []
    for f in files:
        try:
            posts.append(parse_post(f, cfg))
        except Exception as e:
            log.error("파싱 실패 %s: %s", f.name, e)
    if dry_run:
        for p in posts:
            log.info("[DRY] %s | 제목=%s | 카테고리=%s | 태그=%s | 공개=%s | 본문 %d자",
                     p.path.name, p.title, p.category or "-", p.tags, p.visibility, len(p.html))
        return len(posts)

    bot = TistoryBot(cfg)
    ok = 0
    try:
        if not bot.is_logged_in():
            log.error("로그인 필요 → `python tistory_poster.py --login` 먼저 실행")
            return 0
        for i, p in enumerate(posts):
            try:
                url = bot.publish(p)
                log.info("[성공] %s → %s", p.title, url)
                move(p.path, cfg["published_dir"])
                ok += 1
            except Exception as e:
                log.exception("[실패] %s: %s", p.title, e)
                LOG_DIR.mkdir(exist_ok=True)
                try:
                    bot.d.save_screenshot(str(LOG_DIR / f"error_{p.path.stem}.png"))
                except Exception:
                    pass
                move(p.path, cfg["failed_dir"])
            if i < len(posts) - 1:
                time.sleep(cfg.get("wait_between_posts_sec", 30))
    finally:
        bot.close()
    log.info("결과: %d/%d 건 발행", ok, len(posts))
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
    if args.daemon:
        daemon(cfg, [t.strip() for t in args.daemon.split(",")])
        return

    if args.file:
        files = [Path(args.file).resolve()]
    else:
        files = pending_posts(cfg)
        if not args.all:
            files = files[: cfg.get("posts_per_run", 1)]
    run_once(cfg, files, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
