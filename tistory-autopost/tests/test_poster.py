"""발행 판단 로직 점검 (브라우저·네트워크 불필요):  python -m pytest tests -q"""
import datetime as dt
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tistory_poster as tp  # noqa: E402

CFG = {"timezone": "Asia/Seoul", "default_visibility": "public"}


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(tp, "PUBLISH_LOG", tmp_path / "publish_log.jsonl")
    monkeypatch.delenv("GITHUB_EVENT_NAME", raising=False)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    posts = tmp_path / "posts"
    posts.mkdir()
    return {**CFG, "posts_dir": posts}


def published(hours_ago: float):
    at = tp.now(CFG) - dt.timedelta(hours=hours_ago)
    with tp.PUBLISH_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": at.isoformat(timespec="seconds"), "title": "t", "visibility": "public"}) + "\n")


def post(cfg, name, when=None):
    head = f"---\ntitle: {name}\n" + (f"publish_at: {when:%Y-%m-%d %H:%M}\n" if when else "") + "---\n\n본문\n"
    p = cfg["posts_dir"] / f"{name}.md"
    p.write_text(head, encoding="utf-8")
    return p


def test_backlog_goes_out_one_per_day(env):
    files = ["a", "b", "c"]
    assert tp.apply_rate_limit(env, files, quiet=True) == ["a"]          # 이력 없음 → 1회 1편
    published(5)
    assert tp.apply_rate_limit(env, files, quiet=True) == []             # 5시간 전 발행 → 자동 실행은 20시간 간격
    assert "미경과" in tp.LAST_LIMIT_REASON
    tp.PUBLISH_LOG.unlink()
    published(21)
    assert tp.apply_rate_limit(env, files, quiet=True) == ["a"]          # 21시간 경과 → 다음 1편


def test_manual_run_uses_short_gap(env, monkeypatch):
    published(5)
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_dispatch")
    assert tp.apply_rate_limit(env, ["a"], quiet=True) == ["a"]          # 직접 실행은 4시간 간격
    published(1)
    assert tp.apply_rate_limit(env, ["a"], quiet=True) == []


def test_daily_cap(env, monkeypatch):
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_dispatch")
    published(23)
    published(6)
    assert tp.apply_rate_limit(env, ["a"], quiet=True) == []             # 24시간 2편 한도
    assert "24시간" in tp.LAST_LIMIT_REASON


def test_config_overrides_and_empty(env):
    published(2)
    cfg = {**env, "rate_limit": {"min_gap_hours": 1, "max_per_run": 3, "max_per_24h": 5}}
    assert tp.apply_rate_limit(cfg, ["a", "b", "c"], quiet=True) == ["a", "b", "c"]
    assert tp.apply_rate_limit(env, [], quiet=True) == []
    assert tp.LAST_LIMIT_REASON == ""


def test_pending_respects_schedule_order(env):
    t = tp.now(env)
    post(env, "future", t + dt.timedelta(hours=3))
    post(env, "old", t - dt.timedelta(days=2))
    post(env, "older", t - dt.timedelta(days=3))
    post(env, "nodate")
    assert [f.stem for f in tp.pending_posts(env)][:2] == ["older", "old"]
    assert "future" not in [f.stem for f in tp.pending_posts(env)]
    assert [x[1] for x in tp.scheduled_posts(env)] == ["future"]


def test_parse_post_front_matter(env):
    p = env["posts_dir"] / "x.md"
    p.write_text("---\ntitle: 제목: 부제 — 설명\ntags: a, b #c\nvisibility: 비공개\npublish_at: 2026-11-05 09:00\n---\n\n## 소제목\n", encoding="utf-8")
    r = tp.parse_post(p, env)
    assert (r.title, r.tags, r.visibility) == ("제목: 부제 — 설명", ["a", "b", "c"], "private")
    assert r.publish_at.hour == 9 and "<h2>" in r.html
    p.write_text("---\nvisibility: nope\n---\nx", encoding="utf-8")
    with pytest.raises(ValueError):
        tp.parse_post(p, env)


def test_cookie_site_matches_only_target_domains():
    site = tp.TistoryBot._cookie_site
    assert site({"domain": ".tistory.com"}) == "tistory.com"
    assert site({"domain": "hoonnsol.tistory.com"}) == "tistory.com"
    assert site({"domain": "kauth.kakao.com"}) == "kakao.com"
    assert site({"domain": "nottistory.com"}) == ""
    assert site({"domain": ".daum.net"}) == "" and site({}) == ""


def test_front_matter_with_bom_is_read(env):
    p = env["posts_dir"] / "bom.md"
    p.write_bytes("\ufeff---\r\ntitle: 메모장 글\r\nvisibility: private\r\n---\r\n\r\n본문\r\n".encode("utf-8"))
    r = tp.parse_post(p, env)
    assert (r.title, r.visibility) == ("메모장 글", "private")      # BOM 때문에 기본값(공개)으로 읽히면 안 됨


def test_broken_post_is_moved_out_once(env, monkeypatch):
    cfg = {**env, "failed_dir": env["posts_dir"] / "failed", "published_dir": env["posts_dir"] / "published"}
    bad = post(cfg, "bad")
    bad.write_text("---\ntitle: x\npublish_at: 내일 아침\n---\n본문", encoding="utf-8")
    assert tp.pending_posts(cfg) == [bad]                  # 한 번은 대상에 올라 보고됨
    monkeypatch.setattr(tp, "TistoryBot", lambda *a, **k: (_ for _ in ()).throw(AssertionError("브라우저를 띄우면 안 됨")))
    assert tp.run_once(cfg, [bad]) == 0
    assert not bad.exists() and len(list(cfg["failed_dir"].iterdir())) == 1
    assert tp.pending_posts(cfg) == []                     # 다음 실행부터는 반복 실패하지 않음


def test_dry_run_does_not_move_broken_post(env):
    cfg = {**env, "failed_dir": env["posts_dir"] / "failed"}
    bad = post(cfg, "bad")
    bad.write_text("---\nvisibility: nope\n---\n본문", encoding="utf-8")
    assert tp.run_once(cfg, [bad], dry_run=True) == 0 and bad.exists()


def test_mask_personal():
    s = tp.mask_personal("hong.gd+1@nate.com 계정 / ho***@kakao.com / 010-1234-5678 / 01012345678 / 2026-11-05 09:00")
    assert "@" not in s and "1234" not in s and "2026-11-05 09:00" in s


def test_naive_publish_time_is_accepted(env):
    naive = (tp.now(env) - dt.timedelta(hours=1)).replace(tzinfo=None)
    tp.PUBLISH_LOG.write_text(json.dumps({"at": naive.isoformat(timespec="seconds")}) + "\n", encoding="utf-8")
    assert tp.apply_rate_limit(env, ["a"], quiet=True) == []      # 시간대 없는 기록도 비교 오류 없이 제한 적용


def test_feed_title_normalisation():
    assert tp._norm_title("난방비  절약 &amp;mdash; 보일러&middot;단열 ") == "난방비 절약 — 보일러·단열"


def test_unfilled_draft_blanks_block_publish(env):
    p = env["posts_dir"] / "d.md"
    p.write_text("---\ntitle: t\n---\n\n> 📌 **{게임명}** — {보상 — 상세 그대로}\n👉 [가기]({애드픽 홍보 링크})\n", encoding="utf-8")
    with pytest.raises(ValueError, match="빈칸"):
        tp.parse_post(p, env)
    # 코드 예시의 중괄호(영문·기호)는 막지 않음
    p.write_text("---\ntitle: t\n---\n\n```python\nd = {'a': 1}\nprint(f\"{d}\")\n```\n", encoding="utf-8")
    assert tp.parse_post(p, env).title == "t"
