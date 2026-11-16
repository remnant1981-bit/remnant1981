"""로그인·발행 흐름 전체 점검 (가짜 티스토리 서버 + 실제 Chrome).  python -m pytest tests/test_e2e_mock.py -q
Chrome 이나 크롬드라이버를 쓸 수 없는 환경에서는 건너뜀."""
import base64
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mock_tistory  # noqa: E402
import tistory_poster as tp  # noqa: E402


def cookies(tistory="good", kakao=None):
    cs = []
    if tistory:
        cs.append({"name": "TSSESSION", "value": tistory, "domain": ".tistory.com", "path": "/", "secure": True, "httpOnly": True})
    if kakao:
        cs.append({"name": "_kawlt", "value": kakao, "domain": ".kakao.com", "path": "/", "secure": True, "httpOnly": True})
    return base64.b64encode(json.dumps(cs).encode()).decode()


@pytest.fixture
def site(tmp_path, monkeypatch):
    state, port, stop = mock_tistory.start(tmp_path)
    from selenium.webdriver.chrome.options import Options
    orig = Options.__init__

    def init(self, *a, **k):
        orig(self, *a, **k)
        for arg in (f"--host-resolver-rules=MAP *.tistory.com 127.0.0.1:{port}, MAP *.kakao.com 127.0.0.1:{port}",
                    "--ignore-certificate-errors", "--no-proxy-server", "--no-sandbox", "--disable-dev-shm-usage"):
            self.add_argument(arg)
    monkeypatch.setattr(Options, "__init__", init)
    for k in ("TISTORY_COOKIES", "TISTORY_SESSION_FILE", "KAKAO_ID", "KAKAO_PW", "GITHUB_EVENT_NAME", "GITHUB_STEP_SUMMARY", "CI"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("KAKAO_SSO_WAIT", "12")
    monkeypatch.setattr(tp, "PUBLISH_LOG", tmp_path / "publish_log.jsonl")
    monkeypatch.setattr(tp, "LOGIN_STATE", tmp_path / "login_state.json")
    monkeypatch.setattr(tp, "LOG_DIR", tmp_path / "logs")
    posts = tmp_path / "posts"
    posts.mkdir()
    cfg = {"blog_name": mock_tistory.BLOG, "chrome_profile_dir": tmp_path / "prof", "headless": True,
           "timezone": "Asia/Seoul", "default_visibility": "public", "posts_dir": posts,
           "published_dir": posts / "published", "failed_dir": posts / "failed",
           "thumbnail": {"enabled": False}, "wait_between_posts_sec": 0, "feed_check": False}
    yield state, cfg
    stop()


@pytest.fixture
def bot(site):
    _, cfg = site
    try:
        b = tp.TistoryBot(cfg)
    except Exception as e:  # Chrome 없음
        pytest.skip(f"Chrome 실행 불가: {e}")
    yield b
    b.close()


def test_login_with_valid_cookies_saves_session(site, bot, monkeypatch, tmp_path):
    sf = tmp_path / "session.txt"
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    monkeypatch.setenv("TISTORY_SESSION_FILE", str(sf))
    assert bot.is_logged_in() is True
    assert sf.stat().st_size > 0 and Path(str(sf) + ".ok").exists()
    saved = json.loads(base64.b64decode(sf.read_text()))
    assert any(c["name"] == "TSSESSION" and c["value"] == "good" for c in saved)


def test_expired_tistory_session_recovers_via_kakao_cookie(site, bot, monkeypatch, tmp_path):
    state, _ = site
    sf = tmp_path / "session.txt"
    monkeypatch.setenv("TISTORY_COOKIES", cookies("expired", kakao="good"))
    monkeypatch.setenv("TISTORY_SESSION_FILE", str(sf))
    assert bot.is_logged_in() is True
    assert state.sso_hits == 1
    saved = {c["name"]: c["value"] for c in json.loads(base64.b64decode(sf.read_text()))}
    assert saved == {"TSSESSION": "good", "_kawlt": "good"}      # 되살린 세션과 카카오 쿠키 모두 저장


def test_all_cookies_expired_fails_without_marker(site, bot, monkeypatch, tmp_path):
    sf = tmp_path / "session.txt"
    monkeypatch.setenv("TISTORY_COOKIES", cookies("expired", kakao="expired"))
    monkeypatch.setenv("TISTORY_SESSION_FILE", str(sf))
    assert bot.is_logged_in() is False
    assert not Path(str(sf) + ".ok").exists()                     # 실패한 실행은 세션 유지 시각을 갱신하지 않음


def test_stale_saved_session_falls_back_to_secret_cookies(site, bot, monkeypatch, tmp_path):
    sf = tmp_path / "session.txt"
    sf.write_text(cookies("expired"), encoding="utf-8")
    monkeypatch.setenv("TISTORY_SESSION_FILE", str(sf))
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in() is True
    assert json.loads(base64.b64decode(sf.read_text()))[0]["value"] == "good"


def write_post(cfg, name="p1", extra=""):
    p = cfg["posts_dir"] / f"{name}.md"
    p.write_text(f"---\ntitle: 테스트 제목 {name}\ntags: 가, 나, 다\nvisibility: public\n{extra}---\n\n## 소제목\n\n본문 **굵게**\n",
                 encoding="utf-8")
    return p


def test_publish_sends_title_body_tags_visibility(site, bot, monkeypatch):
    state, cfg = site
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in()
    url = bot.publish(tp.parse_post(write_post(cfg), cfg))
    assert "/newpost" not in url
    got = state.published[0]
    assert got["title"] == "테스트 제목 p1" and got["tags"] == ["가", "나", "다"] and got["visibility"] == "open20"
    assert "<h2>소제목</h2>" in got["content"] and "<strong>굵게</strong>" in got["content"]


def test_thumbnail_image_goes_first(site, bot, monkeypatch, tmp_path):
    state, cfg = site
    from PIL import Image
    img = cfg["posts_dir"] / "t.png"
    Image.new("RGB", (10, 10)).save(img)
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in()
    bot.publish(tp.parse_post(write_post(cfg, extra="thumbnail: t.png\n"), cfg))
    c = state.published[0]["content"]
    assert c.startswith("<p><img") and c.index("<img") < c.index("<h2>")


def test_missing_file_input_still_publishes(site, bot, monkeypatch):
    state, cfg = site
    state.file_input = False
    from PIL import Image
    Image.new("RGB", (10, 10)).save(cfg["posts_dir"] / "t.png")
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in()
    bot.publish(tp.parse_post(write_post(cfg, extra="thumbnail: t.png\n"), cfg))
    assert "<img" not in state.published[0]["content"] and "<h2>" in state.published[0]["content"]


def test_run_once_moves_file_and_records(site, monkeypatch):
    state, cfg = site
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    p = write_post(cfg)
    try:
        ok = tp.run_once(cfg, [p])
    except Exception as e:
        pytest.skip(f"Chrome 실행 불가: {e}")
    assert ok == 1 and not p.exists()
    assert len(list(cfg["published_dir"].iterdir())) == 1
    assert len(tp._publish_times()) == 1 and not tp.LOGIN_STATE.exists()
    assert tp.apply_rate_limit(cfg, ["x"], quiet=True) == []      # 방금 발행 → 다음 글은 간격 제한


def test_run_once_login_failure_keeps_post_and_records_state(site, monkeypatch):
    state, cfg = site
    monkeypatch.setenv("TISTORY_COOKIES", cookies("expired"))
    p = write_post(cfg)
    try:
        ok = tp.run_once(cfg, [p])
    except Exception as e:
        pytest.skip(f"Chrome 실행 불가: {e}")
    assert ok == 0 and p.exists() and state.published == []
    st = json.loads(tp.LOGIN_STATE.read_text())
    assert st["status"] == "failed" and st["cookies_fp"] == tp.cookies_fingerprint()


def test_private_post_selects_private(site, bot, monkeypatch):
    state, cfg = site
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in()
    p = write_post(cfg)
    p.write_text(p.read_text(encoding="utf-8").replace("visibility: public", "visibility: private"), encoding="utf-8")
    bot.publish(tp.parse_post(p, cfg))
    assert state.published[0]["visibility"] == "open0"


@pytest.mark.parametrize("mode", ["missing", "stuck"])
def test_unconfirmed_visibility_aborts_before_publishing(site, bot, monkeypatch, mode):
    state, cfg = site
    state.radios = mode
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in()
    p = write_post(cfg)
    p.write_text(p.read_text(encoding="utf-8").replace("visibility: public", "visibility: private"), encoding="utf-8")
    with pytest.raises(RuntimeError, match="공개범위"):
        bot.publish(tp.parse_post(p, cfg))
    assert state.published == []          # 기본값(공개)으로 나가지 않음


def test_emoji_in_title_and_tags(site, bot, monkeypatch):
    state, cfg = site
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    assert bot.is_logged_in()
    p = cfg["posts_dir"] / "e.md"
    p.write_text("---\ntitle: 겨울 준비 ❄️ 체크 🧤 7가지\ntags: 겨울🧣, 한파\n---\n\n본문\n", encoding="utf-8")
    bot.publish(tp.parse_post(p, cfg))
    got = state.published[0]
    assert got["title"] == "겨울 준비 ❄️ 체크 🧤 7가지" and got["tags"] == ["겨울🧣", "한파"]


def test_duplicate_title_in_feed_is_not_published_again(site, monkeypatch):
    state, cfg = site
    cfg["feed_check"] = True
    monkeypatch.setattr(tp, "feed_titles", lambda c: {"테스트 제목 p1"})
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    p = write_post(cfg)
    try:
        ok = tp.run_once(cfg, [p])
    except Exception as e:
        pytest.skip(f"Chrome 실행 불가: {e}")
    assert ok == 1 and state.published == [] and not p.exists()
    assert len(list(cfg["published_dir"].iterdir())) == 1


def test_private_post_seen_in_public_feed_is_reported_as_failure(site, monkeypatch):
    state, cfg = site
    cfg["feed_check"] = True
    calls = []

    def feed(c):
        calls.append(1)
        return set() if len(calls) == 1 else {"테스트 제목 p1"}   # 발행 전에는 없고, 발행 뒤 공개 RSS 에 나타남
    monkeypatch.setattr(tp, "feed_titles", feed)
    monkeypatch.setenv("TISTORY_COOKIES", cookies("good"))
    p = write_post(cfg)
    p.write_text(p.read_text(encoding="utf-8").replace("visibility: public", "visibility: private"), encoding="utf-8")
    try:
        ok = tp.run_once(cfg, [p])
    except Exception as e:
        pytest.skip(f"Chrome 실행 불가: {e}")
    assert len(state.published) == 1 and ok == 0      # 발행은 됐지만 실행은 실패로 표시 → 알림
