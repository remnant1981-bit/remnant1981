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
