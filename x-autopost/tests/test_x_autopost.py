import datetime as dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_tweet  # noqa: E402
import common  # noqa: E402
import tweet_text  # noqa: E402
import x_poster  # noqa: E402

KST = ZoneInfo("Asia/Seoul")
URL = "https://adpick.co.kr/?ac=TEST"


# ---------- tweet_text ----------
def test_weight_korean_double_url_fixed():
    assert tweet_text.weighted_length("abc") == 3
    assert tweet_text.weighted_length("가나") == 4
    assert tweet_text.weighted_length("x " + URL + "?" + "a" * 100) == 2 + 23


def test_disclosure_added_once():
    assert tweet_text.ensure_disclosure("혜택 안내") == "[광고] 혜택 안내"
    assert tweet_text.ensure_disclosure("#광고 혜택") == "#광고 혜택"
    t = tweet_text.compose("혜택 안내", URL)
    assert t.startswith("[광고]") and t.endswith(URL)
    assert tweet_text.compose(t, URL) == t


def test_check_catches_problems():
    assert tweet_text.check(tweet_text.compose("정상 문구", URL), URL) == []
    probs = tweet_text.check("무조건 받으세요 " + "가" * 140, URL)
    joined = " ".join(probs)
    assert "글자 수" in joined and "광고 표시" in joined and "링크" in joined and "무조건" in joined
    assert "빈칸" in " ".join(tweet_text.check(tweet_text.compose("{게임명} 사전예약", URL), URL))


# ---------- fixtures ----------
@pytest.fixture
def cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "BASE_DIR", tmp_path)
    c = json.loads(json.dumps(common.DEFAULT_CONFIG))
    c["quiet_hours"] = []
    return c


def put(cfg, name, **kw):
    it = {"campaign": "A", "url": URL, "text": tweet_text.compose(kw.pop("body", "본문 " + name), URL)}
    it.update(kw)
    qd = common.path(cfg, "queue_dir")
    qd.mkdir(parents=True, exist_ok=True)
    (qd / f"{name}.json").write_text(json.dumps(it, ensure_ascii=False), encoding="utf-8")


class FakeClient:
    def __init__(self, exc=None):
        self.sent, self.exc = [], exc

    def post(self, text):
        if self.exc:
            raise self.exc
        self.sent.append(text)
        return str(1000 + len(self.sent))


NOW = dt.datetime(2026, 11, 18, 12, 0, tzinfo=KST)


# ---------- x_poster ----------
def test_posts_one_and_moves(cfg):
    put(cfg, "01", campaign="A")
    put(cfg, "02", campaign="B")
    fc = FakeClient()
    res = x_poster.run(cfg, client=fc, now=NOW)
    assert len(fc.sent) == 1 and res["posted"][0][0] == "01.json"
    posted = json.loads((common.path(cfg, "posted_dir") / "01.json").read_text(encoding="utf-8"))
    assert posted["tweet_id"] == "1001"
    assert (common.BASE_DIR / "post_log.jsonl").exists()
    # 바로 다시 실행 → 간격 제한
    res2 = x_poster.run(cfg, client=fc, now=NOW + dt.timedelta(minutes=10))
    assert not res2["posted"] and "미경과" in res2["blocked"]
    # 간격 지나면 다음 글
    res3 = x_poster.run(cfg, client=fc, now=NOW + dt.timedelta(hours=4))
    assert res3["posted"][0][0] == "02.json"


def test_daily_cap_and_campaign_cooldown(cfg):
    cfg["rate_limit"].update(min_gap_minutes=0, max_per_run=10, max_per_24h=2)
    for i in range(3):
        put(cfg, f"0{i}", campaign=f"C{i}")
    put(cfg, "09", campaign="C0", body="다른 문구")
    res = x_poster.run(cfg, client=FakeClient(), now=NOW)
    assert len(res["posted"]) == 2 and "24시간" in res["blocked"]
    names = dict(res["waiting"])
    assert "같은 캠페인" in names["09.json"]


def test_schedule_deadline_duplicate(cfg):
    put(cfg, "a", publish_at="2026-11-18 15:00")
    put(cfg, "b", campaign="B", deadline="2026-11-01")
    res = x_poster.run(cfg, client=FakeClient(), now=NOW)
    assert not res["posted"]
    assert dict(res["waiting"])["a.json"].startswith("예약")
    assert "마감" in dict(res["dropped"])["b.json"]
    assert (common.path(cfg, "failed_dir") / "b.json").exists()
    # 예약 시각 지나면 게시, 같은 문구 재등록은 제외
    x_poster.run(cfg, client=FakeClient(), now=NOW + dt.timedelta(hours=4))
    put(cfg, "c", publish_at="")
    (common.path(cfg, "queue_dir") / "c.json").write_text(
        (common.path(cfg, "posted_dir") / "a.json").read_text(encoding="utf-8"), encoding="utf-8")
    res = x_poster.run(cfg, client=FakeClient(), now=NOW + dt.timedelta(days=3))
    assert "이미 게시" in dict(res["dropped"])["c.json"]


def test_invalid_item_dropped(cfg):
    put(cfg, "x", text="광고표시 없음 " + URL)
    qd = common.path(cfg, "queue_dir")
    (qd / "y.json").write_text("{broken", encoding="utf-8")
    res = x_poster.run(cfg, client=FakeClient(), now=NOW)
    d = dict(res["dropped"])
    assert "광고 표시" in d["x.json"] and "JSON" in d["y.json"]
    assert (common.path(cfg, "failed_dir") / "y.json").exists()


def test_errors(cfg):
    put(cfg, "1")
    res = x_poster.run(cfg, client=FakeClient(x_poster.AuthError("bad")), now=NOW)
    assert "AuthError" in res["error"] and (common.path(cfg, "queue_dir") / "1.json").exists()
    res = x_poster.run(cfg, client=FakeClient(x_poster.Rejected("dup")), now=NOW)
    assert (common.path(cfg, "failed_dir") / "1.json").exists()
    put(cfg, "2")
    for _ in range(3):
        x_poster.run(cfg, client=FakeClient(ConnectionError("net")), now=NOW)
    assert (common.path(cfg, "failed_dir") / "2.json").exists()


def test_dry_run_changes_nothing(cfg):
    put(cfg, "1")
    res = x_poster.run(cfg, dry_run=True, now=NOW)
    assert res["posted"] and (common.path(cfg, "queue_dir") / "1.json").exists()
    assert not (common.BASE_DIR / "post_log.jsonl").exists()


def test_quiet_hours(cfg):
    cfg["quiet_hours"] = [1, 7]
    put(cfg, "1")
    res = x_poster.run(cfg, client=FakeClient(), now=NOW.replace(hour=3))
    assert "조용한" in res["blocked"]
    res = x_poster.run(cfg, client=FakeClient(), now=NOW.replace(hour=3), manual=True)
    assert res["posted"]


# ---------- ai_tweet / campaigns ----------
def test_campaigns_and_build_items(cfg):
    (common.BASE_DIR / "campaigns.csv").write_text(
        "name,url,benefit,target,deadline,notes,active\n"
        f"A,{URL},혜택,대상,2099-01-01,,y\n"
        f"B,{URL},혜택,,2000-01-01,,y\n"
        f"C,{URL},혜택,,,,n\n"
        ",빈줄,,,,,\n", encoding="utf-8")
    camps = common.load_campaigns(cfg)
    assert [c["name"] for c in camps] == ["A"]
    items, rejected = ai_tweet.build_items(cfg, camps[0], [
        {"body": "카드 발급하면 캐시백", "angle": "혜택"},
        {"body": "무조건 돈 버는 법", "angle": "x"},
        {"body": "가" * 200, "angle": "x"}])
    assert len(items) == 1 and len(rejected) == 2
    assert items[0]["text"].startswith("[광고]") and URL in items[0]["text"]
    saved = ai_tweet.save(cfg, items)
    assert len(saved) == 1 and ai_tweet.queued_counts(cfg) == {"A": 1}


def test_generate_request_shape(cfg):
    class Msg:
        stop_reason = "end_turn"
        content = [type("B", (), {"type": "text", "text": json.dumps({"tweets": [{"body": "b", "angle": "a"}]})})()]

    class Stream:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get_final_message(self):
            return Msg()

    seen = {}

    class Fake:
        class beta:
            class messages:
                @staticmethod
                def stream(**kw):
                    seen.update(kw)
                    return Stream()

    out = ai_tweet.generate(Fake, cfg, {"name": "A", "url": URL, "benefit": "혜택"}, 2)
    assert out == [{"body": "b", "angle": "a"}]
    assert seen["output_config"]["format"]["type"] == "json_schema"
    assert "혜택" in seen["messages"][0]["content"] and URL not in seen["messages"][0]["content"]


def test_intent_mode(cfg, monkeypatch):
    for k in ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"):
        monkeypatch.delenv(k, raising=False)
    assert isinstance(x_poster.make_client(cfg), x_poster.IntentClient)
    sent = []
    put(cfg, "1", body="한글 본문 & 기호 #태그")
    c = x_poster.IntentClient(sender=lambda t, m, u: sent.append(u) or True)
    res = x_poster.run(cfg, client=c, now=NOW)
    assert res["posted"][0][1] == "intent"
    u = sent[0]
    assert u.startswith("https://x.com/intent/post?text=") and "%23" in u and "%26" in u and " " not in u
    it = json.loads((common.path(cfg, "posted_dir") / "1.json").read_text(encoding="utf-8"))
    assert it["method"] == "intent" and it["intent_url"] == u
    assert "작성 화면 열기" in x_poster.summary_md(res)
    # 알림 설정 없으면 중단, 대기열 유지
    put(cfg, "2", campaign="B")
    res = x_poster.run(cfg, client=x_poster.IntentClient(sender=lambda *a: False), now=NOW + dt.timedelta(hours=4))
    assert "알림 설정 없음" in res["error"] and (common.path(cfg, "queue_dir") / "2.json").exists()
    monkeypatch.setenv("X_API_KEY", "a")
    cfg["post_method"] = "intent"
    assert isinstance(x_poster.make_client(cfg), x_poster.IntentClient)


# ---------- fill_campaign ----------
import fill_campaign  # noqa: E402

CARD = """# 주석
주제: 2
캠페인명: 테스트워크 가입
애드픽 홍보 링크: https://adpick.co.kr/?ac=t1
앱이름: 테스트워크
가입보상: 1,000포인트
적립방법: 걸음 수
출금조건: 5,000포인트부터
대상: 신규 가입자
마감일: 2099-12-31   # 상세 기준
운영자: 운영자A
"""


def test_card_parse_and_fill():
    card = fill_campaign.parse_card(CARD)
    assert card["마감일"] == "2099-12-31" and card["애드픽 홍보 링크"].endswith("t1")
    out, miss = fill_campaign.fill("{앱이름} {가입보상 — 상세 그대로} {운영자 닉네임} {마감일 YYYY-MM-DD} {없는키} { }", card)
    assert out.startswith("테스트워크 1,000포인트 운영자A 2099-12-31") and miss == {"없는키"} and "{ }" in out
    with pytest.raises(ValueError):
        fill_campaign.parse_card("주제: 9")


def test_build_all_channels_filled():
    card = fill_campaign.parse_card(CARD)
    chans = fill_campaign.build(card)
    assert {"x", "tistory", "naver", "threads", "kakao_openchat", "band"} <= set(chans)
    assert "## 0." in chans["kakao_openchat"] and "## 1." not in chans["kakao_openchat"]
    for ch, text in chans.items():
        _, miss = fill_campaign.fill(text, card)
        assert not miss, (ch, miss)
    card["채널"] = "x, tistory"
    assert set(fill_campaign.build(card)) == {"x", "tistory"}


def test_queue_from_templates(cfg):
    card = fill_campaign.parse_card(CARD)
    filled, _ = fill_campaign.fill(fill_campaign.build(card)["x"], card)
    drafts = fill_campaign.tweet_drafts(filled)
    assert len(drafts) == 5 and all("<br>" not in d["body"] for d in drafts)
    saved, rejected = fill_campaign.queue_tweets(card, filled)
    assert len(saved) == 5 and not rejected
    it = json.loads(saved[0].read_text(encoding="utf-8"))
    assert it["text"].startswith("[광고]") and it["url"] in it["text"] and it["deadline"] == "2099-12-31"
