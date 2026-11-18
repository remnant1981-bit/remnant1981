"""
queue/*.json 트윗을 X(x.com)에 게시 (X API v2, OAuth 1.0a 사용자 인증)

사용법:
  python x_poster.py               # 게시 조건을 만족하는 대기 글 max_per_run 개 게시
  python x_poster.py --list        # 대기열·다음 게시 가능 시각 확인
  python x_poster.py --dry-run     # 게시 없이 무엇을 올릴지 출력
  python x_poster.py --check       # API 키 확인 (계정 이름 출력)
  python x_poster.py --manual      # 직접 실행: 간격 제한만 완화 (24시간 최대 건수는 그대로)

게시 방식 (config.json → post_method):
  auto   : X API 키가 있으면 api, 없으면 intent (기본)
  api    : X API 로 바로 게시 — 환경변수 X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (사용량 과금)
  intent : 무료. 휴대폰 알림(ntfy/텔레그램)으로 X 작성 링크 전송 → 탭하면 본문이 채워진 X 앱 → [게시]
게시 조건 (config.json → rate_limit / quiet_hours):
  - publish_at 이 지났거나 비어 있음, 캠페인 마감 전
  - 직전 게시 후 min_gap_minutes 경과, 24시간 max_per_24h 미만, 같은 캠페인 cooldown 경과
  - 조용한 시간대(quiet_hours) 아님
  - 같은 문구를 이미 올린 적 없음
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import urllib.parse
from pathlib import Path

import common
import tweet_text

LOG_NAME = "post_log.jsonl"
MAX_ATTEMPTS = 3


class AuthError(Exception):
    pass


class RateLimited(Exception):
    pass


class Rejected(Exception):
    """X 가 이 글을 거부 (중복·정책 위반 등) → 재시도 무의미"""


class XClient:
    def __init__(self):
        keys = [os.environ.get(k, "").strip() for k in
                ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET")]
        if not all(keys):
            raise AuthError("X API 키 미설정 (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET)")
        import tweepy
        self.tweepy = tweepy
        self.c = tweepy.Client(consumer_key=keys[0], consumer_secret=keys[1],
                               access_token=keys[2], access_token_secret=keys[3])

    def _wrap(self, fn):
        t = self.tweepy
        try:
            return fn()
        except t.Unauthorized as e:
            raise AuthError(f"인증 실패: {e}") from e
        except t.TooManyRequests as e:
            raise RateLimited(str(e)) from e
        except t.Forbidden as e:
            msg = str(e)
            # 402/403: 크레딧 부족·앱 권한(Read only) 문제는 글 문제가 아님
            if "credit" in msg.lower() or "permission" in msg.lower() or "oauth" in msg.lower():
                raise AuthError(msg) from e
            raise Rejected(msg) from e
        except t.BadRequest as e:
            raise Rejected(str(e)) from e

    def post(self, text: str) -> str:
        r = self._wrap(lambda: self.c.create_tweet(text=text, user_auth=True))
        return str(r.data["id"])

    def me(self) -> str:
        r = self._wrap(lambda: self.c.get_me(user_auth=True))
        return r.data.username


def intent_url(text: str) -> str:
    """X 작성 화면 링크 — 휴대폰에서 열면 X 앱에 본문이 채워진 채로 열림 (API·비용 불필요)"""
    return "https://x.com/intent/post?text=" + urllib.parse.quote(text, safe="")


class IntentClient:
    """API 없이: 작성 링크를 휴대폰 알림(ntfy/텔레그램)으로 보냄 → 탭 → [게시] 1번"""
    method = "intent"

    def __init__(self, sender=None):
        self.sender = sender or _notify_send

    def post(self, text: str) -> str:
        url = intent_url(text)
        if not self.sender("X에 올릴 글 (탭 → 게시)", text, url):
            raise AuthError("알림 설정 없음 (NTFY_TOPIC 또는 TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID 필요)")
        return "intent"

    def me(self) -> str:
        return "(작성 링크 알림 방식)"


def has_api_keys() -> bool:
    return all(os.environ.get(k, "").strip() for k in
               ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"))


def make_client(cfg: dict):
    """post_method: api / intent / auto(키 있으면 api, 없으면 intent)"""
    m = cfg.get("post_method", "auto")
    if m == "intent" or (m == "auto" and not has_api_keys()):
        return IntentClient()
    return XClient()


def text_hash(text: str) -> str:
    return hashlib.sha1(text.strip().encode()).hexdigest()[:16]


def load_queue(cfg: dict) -> list[tuple[Path, dict]]:
    out = []
    for f in sorted(common.path(cfg, "queue_dir").glob("*.json")):
        try:
            out.append((f, json.loads(f.read_text(encoding="utf-8"))))
        except Exception as e:
            out.append((f, {"_error": f"JSON 오류: {e}"}))
    def key(x):
        it = x[1]
        return (it.get("publish_at") or it.get("created_at") or "", x[0].name)
    return sorted(out, key=key)


def gate(cfg: dict, log: list[dict], now: dt.datetime, manual: bool = False) -> str:
    """계정 단위 제한 → 막히면 사유, 통과면 ''"""
    rl = cfg["rate_limit"]
    times = [common.parse_time(r["time"], cfg) for r in log if r.get("time")]
    recent = [t for t in times if now - t < dt.timedelta(hours=24)]
    if len(recent) >= int(rl["max_per_24h"]):
        nxt = min(recent) + dt.timedelta(hours=24)
        return f"24시간 최대 {rl['max_per_24h']}건 도달 (다음 가능 {nxt:%m-%d %H:%M})"
    gap = int(rl["min_gap_minutes"]) // (4 if manual else 1)
    if times and now - max(times) < dt.timedelta(minutes=gap):
        nxt = max(times) + dt.timedelta(minutes=gap)
        return f"직전 게시 후 {gap}분 미경과 (다음 가능 {nxt:%m-%d %H:%M})"
    q = cfg.get("quiet_hours") or []
    if not manual and len(q) == 2 and q[0] <= now.hour < q[1]:
        return f"조용한 시간대 {q[0]:02d}~{q[1]:02d}시"
    return ""


def item_status(cfg: dict, it: dict, log: list[dict], now: dt.datetime) -> tuple[str, str]:
    """('ready'|'wait'|'drop', 사유)"""
    if it.get("_error"):
        return "drop", it["_error"]
    for k in ("text", "campaign"):
        if not it.get(k):
            return "drop", f"{k} 없음"
    problems = tweet_text.check(it["text"], it.get("url", ""), cfg["disclosure"])
    if problems:
        return "drop", ", ".join(problems)
    if it.get("deadline"):
        try:
            if dt.date.fromisoformat(it["deadline"]) < now.date():
                return "drop", f"캠페인 마감 ({it['deadline']})"
        except ValueError:
            pass
    h = text_hash(it["text"])
    if any(r.get("hash") == h for r in log):
        return "drop", "같은 문구 이미 게시됨"
    try:
        pa = common.parse_time(it.get("publish_at", ""), cfg)
    except ValueError:
        return "drop", f"publish_at 형식 오류: {it.get('publish_at')}"
    if pa and pa > now:
        return "wait", f"예약 {pa:%m-%d %H:%M}"
    cd = dt.timedelta(hours=float(cfg["rate_limit"]["campaign_cooldown_hours"]))
    last = [common.parse_time(r["time"], cfg) for r in log if r.get("campaign") == it["campaign"]]
    if last and now - max(last) < cd:
        return "wait", f"같은 캠페인 대기 (다음 {max(last) + cd:%m-%d %H:%M})"
    return "ready", ""


def _move(src: Path, dst_dir: Path, it: dict | None = None) -> Path:
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / src.name
    if it is not None:
        dst.write_text(json.dumps(it, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        src.unlink()
    else:
        shutil.move(str(src), dst)
    return dst


def run(cfg: dict, client=None, dry_run: bool = False, manual: bool = False, now=None) -> dict:
    now = now or common.now(cfg)
    log_path = common.BASE_DIR / LOG_NAME
    log = common.read_jsonl(log_path)
    res = {"posted": [], "dropped": [], "waiting": [], "blocked": "", "error": ""}
    max_run = int(cfg["rate_limit"]["max_per_run"])

    for f, it in load_queue(cfg):
        st, why = item_status(cfg, it, log, now)
        if st == "drop":
            res["dropped"].append((f.name, why))
            if not dry_run:
                it = {k: v for k, v in it.items() if k != "_error"} or {}
                it["fail_reason"] = why
                _move(f, common.path(cfg, "failed_dir"), it if it.get("text") else None)
            continue
        if st == "wait":
            res["waiting"].append((f.name, why))
            continue
        if len(res["posted"]) >= max_run:
            res["waiting"].append((f.name, "이번 실행 한도"))
            continue
        blocked = gate(cfg, log, now, manual)
        if blocked:
            res["blocked"] = blocked
            res["waiting"].append((f.name, blocked))
            continue
        if dry_run:
            res["posted"].append((f.name, "(dry-run)", it["text"]))
            log.append({"time": now.isoformat(), "campaign": it["campaign"], "hash": text_hash(it["text"])})
            continue
        try:
            client = client or make_client(cfg)
            tid = client.post(it["text"])
        except (AuthError, RateLimited) as e:
            res["error"] = f"{type(e).__name__}: {e}"
            break
        except Rejected as e:
            it["fail_reason"] = f"X 거부: {e}"
            _move(f, common.path(cfg, "failed_dir"), it)
            res["dropped"].append((f.name, it["fail_reason"]))
            continue
        except Exception as e:   # 네트워크 등 일시 오류 → 대기열에 두고 재시도
            it["attempts"] = int(it.get("attempts", 0)) + 1
            it["last_error"] = str(e)[:300]
            if it["attempts"] >= MAX_ATTEMPTS:
                it["fail_reason"] = f"{MAX_ATTEMPTS}회 실패: {e}"
                _move(f, common.path(cfg, "failed_dir"), it)
                res["dropped"].append((f.name, it["fail_reason"]))
            else:
                f.write_text(json.dumps(it, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                res["waiting"].append((f.name, f"오류 재시도 예정: {e}"))
            continue
        row = {"time": now.isoformat(timespec="seconds"), "tweet_id": tid,
               "campaign": it["campaign"], "hash": text_hash(it["text"])}
        common.append_jsonl(log_path, row)
        log.append(row)
        if tid == "intent":
            row["method"] = "intent"
            it.update(sent_at=row["time"], method="intent", intent_url=intent_url(it["text"]))
        else:
            it.update(posted_at=row["time"], tweet_id=tid)
        _move(f, common.path(cfg, "posted_dir"), it)
        res["posted"].append((f.name, tid, it["text"]))
    return res


def summary_md(res: dict) -> str:
    lines = ["## X 자동 게시 결과", ""]
    if res["error"]:
        lines += [f"❌ **중단**: {res['error']}", ""]
    if res["posted"]:
        lines += ["| 파일 | 트윗 | 본문 |", "|---|---|---|"]
        for name, tid, text in res["posted"]:
            link = (f"[보기](https://x.com/i/web/status/{tid})" if tid.isdigit()
                    else f"[작성 화면 열기]({intent_url(text)})" if tid == "intent" else tid)
            lines.append(f"| {name} | {link} | {text.replace(chr(10), ' ').replace('|', '/')[:80]} |")
    else:
        lines.append(f"게시 없음{' — ' + res['blocked'] if res['blocked'] else ''}")
    if res["dropped"]:
        lines += ["", "**제외 (queue/failed 로 이동)**", ""] + [f"- {n}: {w}" for n, w in res["dropped"]]
    if res["waiting"]:
        lines += ["", f"⏳ 대기 {len(res['waiting'])}건", ""] + [f"- {n}: {w}" for n, w in res["waiting"][:15]]
    return "\n".join(lines) + "\n"


def _notify_send(title: str, msg: str, url: str = "", priority: str = "default") -> bool:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tistory-autopost"))
    try:
        import notify
        return notify.send(title, msg, url=url, priority=priority)
    except Exception as e:
        print(f"[알림] 실패: {e}", file=sys.stderr)
        return False


def _notify(title: str, msg: str, priority: str = "default") -> None:
    _notify_send(title, msg, priority=priority)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="X 자동 게시")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--manual", action="store_true", help="직접 실행: 간격 1/4·조용한 시간 무시")
    a = ap.parse_args(argv)
    cfg = common.load_config()

    if a.check:
        try:
            c = make_client(cfg)
            if isinstance(c, IntentClient):
                ok = _notify_send("X 자동 게시 연결 점검", "이 알림을 탭하면 X 작성 화면이 열림",
                                  intent_url("[테스트] 연결 점검 — 게시하지 말고 닫을 것"))
                print("✓ 작성 링크 알림 방식: 알림 전송됨" if ok else
                      "✗ X API 키도 알림 설정도 없음 (NTFY_TOPIC 또는 TELEGRAM_* 필요)")
                return 0 if ok else 2
            print(f"✓ X API 연결됨: @{c.me()}")
            return 0
        except Exception as e:
            print(f"✗ {e}")
            return 2

    res = run(cfg, dry_run=a.dry_run or a.list, manual=a.manual)
    md = summary_md(res)
    print(md)
    if os.environ.get("GITHUB_STEP_SUMMARY") and not a.list:
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fp:
            fp.write(md)
    if a.dry_run or a.list:
        return 0
    if res["error"]:
        _notify("X 게시 중단", res["error"], "high")
        return 2
    if res["posted"] and not all(t == "intent" for _, t, _ in res["posted"]):
        _notify("X 게시 완료", "\n".join(t for _, _, t in res["posted"])[:500])
    if res["dropped"]:
        _notify("X 게시 제외", "\n".join(f"{n}: {w}" for n, w in res["dropped"])[:500])
    return 0


if __name__ == "__main__":
    sys.exit(main())
