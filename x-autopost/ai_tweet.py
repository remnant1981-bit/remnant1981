"""
애드픽 캠페인 → Claude 로 트윗 초안 작성 → queue/*.json 저장 (발행은 x_poster.py)

사용법:
  python ai_tweet.py                       # campaigns.csv 에서 대기열이 가장 적은 캠페인 1개
  python ai_tweet.py --count 3             # 캠페인 3개
  python ai_tweet.py --campaign "토스뱅크"  # 이름에 포함된 캠페인만
  python ai_tweet.py --variants 5 --publish-at "2026-11-20 12:00"
  python ai_tweet.py --dry-run             # 저장 없이 출력

API 키: 환경변수 ANTHROPIC_API_KEY
"""

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import common
import tweet_text

SCHEMA = {
    "type": "object",
    "properties": {
        "tweets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "body": {"type": "string", "description": "광고 표시·링크 제외 본문"},
                    "angle": {"type": "string", "description": "이 트윗의 접근 방식 (예: 혜택 요약, 대상 질문형, 마감 안내)"},
                },
                "required": ["body", "angle"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["tweets"],
    "additionalProperties": False,
}

SYSTEM = """너는 한국어 X(트위터) 제휴마케팅 카피라이터다. 애드픽 CPA 캠페인 홍보 트윗을 쓴다.

[분량] 본문은 한글 기준 90자 이내 (X는 한글 1자를 2로 셈. 광고 표시·링크는 코드가 붙이므로 본문에 넣지 말 것)
[정직성 — 반드시 지킬 것]
- 캠페인 정보에 있는 혜택·조건만 쓴다. 금액·기간·확률을 지어내지 않는다
- "써 봤는데", "저도 받았어요" 같은 1인칭 체험·후기를 지어내지 않는다
- "무조건", "100%", "누구나 수익", "평생", "확정" 같은 단정·과장 표현 금지
- 조건(대상·기간)이 있으면 짧게라도 밝힌다
[형식]
- 첫 줄에 핵심 혜택, 다음 줄에 대상·조건 또는 행동 유도 한 줄
- 해시태그 0~2개, 이모지 0~1개
- 초안마다 접근 방식을 다르게 (혜택 요약 / 대상에게 묻는 질문형 / 마감·조건 안내 / 비교·팁형)
"""


def _client():
    import anthropic
    return anthropic.Anthropic()


def generate(client, cfg: dict, camp: dict, variants: int, extra: str = "") -> list[dict]:
    ai = cfg["ai"]
    info = "\n".join(f"- {k}: {camp[k]}" for k in ("name", "benefit", "target", "deadline", "notes") if camp.get(k))
    user = f"캠페인 정보:\n{info}\n\n서로 다른 트윗 초안 {variants}개 작성."
    if ai.get("style_prompt"):
        user += f"\n계정 문체: {ai['style_prompt']}"
    if extra:
        user += f"\n추가 요청: {extra}"
    with client.beta.messages.stream(
        model=ai["model"],
        max_tokens=4000,
        system=SYSTEM,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": ai["effort"], "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise RuntimeError("모델이 작성 거절")
    text = next((b.text for b in msg.content if b.type == "text"), "")
    return json.loads(text)["tweets"]


def build_items(cfg: dict, camp: dict, drafts: list[dict], publish_at: str = "") -> tuple[list[dict], list[str]]:
    """초안 → 대기열 항목 (검사 실패 초안은 버리고 사유 반환)"""
    items, rejected = [], []
    created = common.now(cfg).isoformat(timespec="seconds")
    for d in drafts:
        text = tweet_text.compose(d["body"], camp["url"], cfg["disclosure"])
        problems = tweet_text.check(text, camp["url"], cfg["disclosure"])
        if problems:
            rejected.append(f"{d['body'][:30]}… → {', '.join(problems)}")
            continue
        h = hashlib.sha1(text.encode()).hexdigest()[:10]
        items.append({"id": h, "campaign": camp["name"], "url": camp["url"], "text": text,
                      "angle": d.get("angle", ""), "publish_at": publish_at, "created_at": created,
                      "deadline": camp.get("deadline", "")})
    return items, rejected


def queued_counts(cfg: dict) -> dict:
    counts = {}
    for f in common.path(cfg, "queue_dir").glob("*.json"):
        try:
            c = json.loads(f.read_text(encoding="utf-8"))["campaign"]
            counts[c] = counts.get(c, 0) + 1
        except Exception:
            pass
    return counts


def save(cfg: dict, items: list[dict]) -> list[Path]:
    qd = common.path(cfg, "queue_dir")
    qd.mkdir(parents=True, exist_ok=True)
    stamp = common.now(cfg).strftime("%Y%m%d_%H%M")
    out = []
    for it in items:
        p = qd / f"{stamp}_{it['id']}.json"
        if not p.exists():
            p.write_text(json.dumps(it, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            out.append(p)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="애드픽 캠페인 트윗 초안 작성")
    ap.add_argument("--campaign", default="", help="캠페인 이름 일부")
    ap.add_argument("--count", type=int, default=1, help="작성할 캠페인 수")
    ap.add_argument("--variants", type=int, default=0, help="캠페인당 초안 수 (기본: config)")
    ap.add_argument("--publish-at", default="", help="예약 시각 'YYYY-MM-DD HH:MM' (비우면 순서대로)")
    ap.add_argument("--extra", default="", help="추가 요청")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    cfg = common.load_config()
    if a.publish_at:
        common.parse_time(a.publish_at, cfg)   # 형식 오류면 여기서 중단
    camps = common.load_campaigns(cfg)
    if a.campaign:
        camps = [c for c in camps if a.campaign in c["name"]]
    if not camps:
        print("작성할 캠페인 없음 (campaigns.csv 확인: 이름·링크 필수, 마감 지난 캠페인 제외)")
        return 1
    counts = queued_counts(cfg)
    camps.sort(key=lambda c: counts.get(c["name"], 0))   # 대기열이 적은 캠페인부터
    variants = a.variants or int(cfg["ai"]["variants"])

    client = _client()
    total = 0
    for camp in camps[: max(1, a.count)]:
        print(f"■ {camp['name']}")
        items, rejected = build_items(cfg, camp, generate(client, cfg, camp, variants, a.extra), a.publish_at)
        for r in rejected:
            print(f"  ✗ 제외: {r}")
        for it in items:
            print(f"  ✓ ({tweet_text.weighted_length(it['text'])}/280) {it['text']!r}")
        if not a.dry_run:
            total += len(save(cfg, items))
    print(f"대기열 저장 {total}건" if not a.dry_run else "dry-run: 저장 안 함")
    return 0


if __name__ == "__main__":
    sys.exit(main())
