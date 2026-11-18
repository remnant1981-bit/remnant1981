"""
캠페인 카드 1장 → 12개 채널 초안 빈칸을 채운 완성본 생성

사용법:
  python fill_campaign.py cards/예시_앱테크.txt            # out/<캠페인명>/ 에 채널별 완성본
  python fill_campaign.py cards/내카드.txt --register      # + campaigns.csv 에 등록 (X AI 초안용)
  python fill_campaign.py cards/내카드.txt --queue         # + X 트윗 5종 검사 후 게시 대기열(queue/) 등록
  python fill_campaign.py --template 2                     # 주제 2(앱테크)용 빈 카드 출력

카드 형식 (한 줄에 '키: 값', # 으로 시작하면 주석):
  주제: 2                     # 1 게임 / 2 앱테크 / 3 쇼핑 / 4 웹툰·OTT / 5 수험생·알바
  캠페인명: ○○ 가입
  애드픽 홍보 링크: https://...
  가입보상: ...               # 키 = 초안의 {빈칸} 이름
허용 채널(선택): 채널: x, threads, tistory ...  (비우면 전부)
"""

import argparse
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
XD = ROOT / "x-autopost" / "drafts"

TOPICS = {
    1: {"name": "게임 사전예약", "x": "game_preregister.md", "tistory": "01_game_preregister.md",
        "naver": "01_game_preregister.txt", "benefit": "보상",
        "keys": ["게임명", "보상", "출시일", "마감일", "플랫폼", "장르", "대상"]},
    2: {"name": "앱테크", "x": "apptech.md", "tistory": "02_apptech.md", "naver": "02_apptech.txt",
        "benefit": "가입보상", "keys": ["앱이름", "가입보상", "적립방법", "출금조건", "대상", "마감일"]},
    3: {"name": "쇼핑 첫 구매", "x": "shopping.md", "tistory": "03_shopping.md", "naver": "03_shopping.txt",
        "benefit": "첫구매혜택", "keys": ["쇼핑몰", "첫구매혜택", "최소주문", "대상", "마감일", "행사명", "기간"]},
    4: {"name": "웹툰·OTT", "x": "webtoon_ott.md", "tistory": "04_webtoon_ott.md", "naver": "04_subscription.txt",
        "benefit": "무료혜택", "keys": ["서비스", "무료혜택", "전환조건", "대상", "마감일", "대표작", "시즌"]},
    5: {"name": "수험생·알바", "x": "student.md", "tistory": "05_student_job.md", "naver": "05_student_job_docs.txt",
        "benefit": "혜택", "keys": ["앱이름", "혜택", "용도", "대상", "조건", "마감일", "시즌"]},
}
COMMON_KEYS = ["캠페인명", "애드픽 홍보 링크", "운영자", "채널"]

# 여러 주제가 섹션('## N.')으로 들어 있는 채널 파일
MULTI = {"threads": "threads.md", "instagram": "instagram.md", "facebook": "facebook.md",
         "pinterest": "pinterest.md", "youtube_shorts": "youtube_shorts.md", "tiktok": "tiktok.md",
         "kakao_openchat": "kakao_openchat.md", "band": "band.md"}
ALIASES = {"운영자 닉네임": "운영자", "운영자 이름": "운영자", "플랫폼·대상": "플랫폼"}
PH = re.compile(r"\{([^{}]+)\}")


def parse_card(text: str) -> dict:
    card = {}
    for line in text.splitlines():
        line = re.sub(r"\s+#\s.*$", "", line).strip()   # 줄 끝 ' # 주석' 제거
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        if k.strip() and v.strip():
            card[k.strip()] = v.strip()
    if "주제" not in card or not card["주제"].isdigit() or int(card["주제"]) not in TOPICS:
        raise ValueError("카드에 '주제: 1~5' 필요")
    if not card.get("애드픽 홍보 링크", "").startswith("http"):
        raise ValueError("카드에 '애드픽 홍보 링크: https://...' 필요")
    return card


def _key(name: str) -> str:
    name = name.split("—")[0].strip()
    return ALIASES.get(name, name)


def fill(text: str, card: dict) -> tuple[str, set]:
    missing = set()

    def rep(m):
        raw = m.group(1)
        k = _key(raw)
        for cand in (k, k.split()[0] if k.split() else k):
            if cand in card:
                return card[cand]
        if k in ("", "…", " "):
            return m.group(0)
        missing.add(k)
        return m.group(0)
    return PH.sub(rep, text), missing


def section(text: str, num: int, with_setup: bool = True) -> str:
    """'## N.' 섹션 (+ '## 0.' 설정 섹션) 추출"""
    parts = re.split(r"(?m)^(?=## )", text)
    head = parts[0]
    picked = [p for p in parts[1:] if re.match(rf"## {num}\.", p)]
    if with_setup:
        picked = [p for p in parts[1:] if re.match(r"## 0\.", p)] + picked
    return head + "".join(picked)


def build(card: dict) -> dict[str, str]:
    t = TOPICS[int(card["주제"])]
    num = int(card["주제"])
    out = {
        "x": (XD / t["x"]).read_text(encoding="utf-8"),
        "tistory": (ROOT / "tistory-autopost/drafts/adpick" / t["tistory"]).read_text(encoding="utf-8"),
        "naver": (ROOT / "naver-blog/drafts" / t["naver"]).read_text(encoding="utf-8"),
    }
    for ch, fn in MULTI.items():
        sec = section((XD / fn).read_text(encoding="utf-8"), num)
        if re.search(rf"(?m)^## {num}\.", sec):
            out[ch] = sec
    allowed = [c.strip().lower() for c in card.get("채널", "").split(",") if c.strip()]
    if allowed:
        out = {k: v for k, v in out.items() if k in allowed}
    return out


def register(card: dict, csv_path: Path) -> bool:
    t = TOPICS[int(card["주제"])]
    name = card.get("캠페인명") or card.get(t["keys"][0], "")
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8-sig"))) if csv_path.exists() else []
    if any(r.get("name") == name for r in rows):
        return False
    notes = " / ".join(f"{k}: {card[k]}" for k in t["keys"][2:] if k in card and k not in ("대상", "마감일"))
    if card.get("금지 문구"):
        notes += f" / 금지 문구: {card['금지 문구']}"
    new = csv_path.exists() and csv_path.stat().st_size > 0
    with csv_path.open("a", encoding="utf-8", newline="") as fp:
        w = csv.writer(fp)
        if not new:
            w.writerow(["name", "url", "benefit", "target", "deadline", "notes", "active"])
        w.writerow([name, card["애드픽 홍보 링크"], card.get(t["benefit"], ""), card.get("대상", ""),
                    card.get("마감일", ""), notes, "y"])
    return True


ROW = re.compile(r"(?m)^\| \d \| ([^|]+) \| ([^|]+) \| 약 \d+ \|$")


def tweet_drafts(filled_x: str) -> list[dict]:
    """채운 X 초안 표 → [{'body','angle'}] (<br> → 줄바꿈, '(OTT면 #OTT)' 같은 안내 괄호 제거)"""
    out = []
    for angle, body in ROW.findall(filled_x):
        body = re.sub(r"\s*\([^()]*#[^()]*\)", "", body).replace("<br>", "\n").strip()
        out.append({"body": body, "angle": angle.replace("*", "").strip()})
    return out


def queue_tweets(card: dict, filled_x: str, publish_at: str = "") -> tuple[list, list]:
    """X 초안 5종 → 검사 → queue/ 저장 (빈칸·글자 수·과장 표현 걸리면 제외)"""
    sys.path.insert(0, str(ROOT / "x-autopost"))
    import ai_tweet
    import common
    cfg = common.load_config()
    t = TOPICS[int(card["주제"])]
    camp = {"name": card.get("캠페인명") or card.get(t["keys"][0], ""), "url": card["애드픽 홍보 링크"],
            "deadline": card.get("마감일", "") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", card.get("마감일", "")) else ""}
    items, rejected = ai_tweet.build_items(cfg, camp, tweet_drafts(filled_x), publish_at)
    return ai_tweet.save(cfg, items), rejected


def template(num: int) -> str:
    t = TOPICS[num]
    lines = [f"# {t['name']} 캠페인 카드 — 애드픽 캠페인 상세 문구 그대로 입력",
             f"주제: {num}", "캠페인명: ", "애드픽 홍보 링크: "]
    lines += [f"{k}: " for k in t["keys"]]
    lines += ["운영자: ", "금지 문구: ", "# 채널: x, threads, instagram, facebook, pinterest, youtube_shorts, "
              "tiktok, kakao_openchat, band, tistory, naver   (홍보 허용 매체만 남기기, 비우면 전부)", "채널: "]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="캠페인 카드 → 채널별 완성본")
    ap.add_argument("card", nargs="?")
    ap.add_argument("--register", action="store_true", help="campaigns.csv 에 등록")
    ap.add_argument("--queue", action="store_true", help="X 트윗 5종을 검사 후 queue/ 에 등록")
    ap.add_argument("--template", type=int, choices=list(TOPICS))
    ap.add_argument("--out", default=str(ROOT / "x-autopost" / "out"))
    a = ap.parse_args(argv)
    if a.template:
        print(template(a.template), end="")
        return 0
    if not a.card:
        ap.error("카드 파일 필요 (빈 카드: --template 1~5)")
    card = parse_card(Path(a.card).read_text(encoding="utf-8-sig"))
    t = TOPICS[int(card["주제"])]
    name = card.get("캠페인명") or card.get(t["keys"][0], "campaign")
    od = Path(a.out) / re.sub(r"[\\/:*?\"<>|\s]+", "_", name)
    od.mkdir(parents=True, exist_ok=True)
    report, filled_x = [], ""
    for ch, text in build(card).items():
        filled, missing = fill(text, card)
        if ch == "x":
            filled_x = filled
        ext = ".txt" if ch == "naver" else ".md"
        (od / f"{ch}{ext}").write_text(filled, encoding="utf-8")
        report.append((ch, sorted(missing)))
    print(f"■ {name} ({t['name']}) → {od}")
    for ch, miss in report:
        print(f"  {'✓' if not miss else '△'} {ch:15s} {'완성' if not miss else '빈칸 남음: ' + ', '.join(miss)}")
    if a.register:
        ok = register(card, ROOT / "x-autopost" / "campaigns.csv")
        print("campaigns.csv 등록 완료" if ok else "campaigns.csv 에 같은 이름 이미 있음 (건너뜀)")
    if a.queue:
        if not filled_x:
            print("X 채널이 '채널:' 목록에 없어 대기열 등록 안 함")
        else:
            saved, rejected = queue_tweets(card, filled_x)
            print(f"X 대기열 등록 {len(saved)}건")
            for r in rejected:
                print(f"  ✗ 제외: {r}")
    print("※ 티스토리 완성본은 확인 후 tistory-autopost/posts/ 로 옮기면 자동 발행")
    return 0


if __name__ == "__main__":
    sys.exit(main())
