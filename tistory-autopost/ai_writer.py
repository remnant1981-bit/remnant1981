"""
Claude API 기반 블로그 본문 자동 작성기

주제 → Claude 가 제목 후보·키워드·태그·본문(마크다운)·SNS 글 작성 → posts/ 에 .md 저장
→ tistory_poster.py 가 그대로 발행

품질 관리 (Uplika 스킬 기반, prompts.py / quality.py 참고):
  - 한국어 문체·정직성·구조 규칙 + 도입부 훅 패턴 19종 (최근 쓴 패턴은 피함)
  - 제목 후보 여러 개 → 자동 점수로 최선 선택
  - 문체 검사(강조어·번역투·어미 혼용 등) → 문제 시 1회 자동 수정
  - 네이버 AI 브리핑 가이드 15개 항목 자체 점검 → 정직성 미달 시 비공개 보류
  - voice.md (문체 프로필) 있으면 최우선 적용

사용법:
  python ai_writer.py "액화수소 저장 기술 동향" "셀레니움 자동화 팁"
  python ai_writer.py --topics-file topics.txt          # 한 줄 = 한 주제 (작성한 줄은 파일에서 제거)
  python ai_writer.py "주제" --category IT --visibility private
  python ai_writer.py "주제" --publish                  # 작성 직후 바로 발행

API 키: 환경변수 ANTHROPIC_API_KEY 설정 필요
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

import anthropic

import prompts
import quality

BASE_DIR = Path(__file__).resolve().parent

DEFAULT_AI = {
    "model": "claude-opus-5-5",
    "effort": "medium",
    "min_chars": 2000,
    "title_candidates": 8,   # 제목 후보 수 (자동 검사로 최선 선택)
    "quality_gate": True,    # 문체 검사 후 문제 있으면 1회 자동 수정
    "self_check": True,      # 15개 항목 자체 점검 (정직성 항목 미달 시 비공개 보류)
    "sns": True,             # Threads·SNS용 재가공 글 생성
    "style_prompt": "",      # 블로그별 추가 지시 (예: 'R&D·공학 실무자 대상, 합니다체')
}

SCHEMA = {
    "type": "object",
    "properties": {
        "title_candidates": {"type": "array", "items": {"type": "string"},
                             "description": "서로 다른 제목 후보 (요청 개수만큼)"},
        "keywords": {
            "type": "object",
            "properties": {
                "main": {"type": "string", "description": "이 글이 노리는 핵심 검색 키워드 1개"},
                "sub": {"type": "array", "items": {"type": "string"}, "description": "보조 키워드 3~6개"},
            },
            "required": ["main", "sub"],
            "additionalProperties": False,
        },
        "hook_pattern": {"type": "string", "description": "본문 첫 문장에 사용한 훅 패턴 번호와 이름 (예: '4 결론부터 말하면')"},
        "tags": {"type": "array", "items": {"type": "string"}, "description": "태그 5~10개"},
        "thumbnail_text": {"type": "string",
                           "description": "썸네일 이미지 큰 글씨 (14자 안팎, 제목과 다른 표현, 핵심 숫자·대상 위주)"},
        "body_markdown": {"type": "string", "description": "본문 마크다운 (제목 H1 제외)"},
        "sns": {
            "type": "object",
            "properties": {
                "threads": {"type": "string", "description": "Threads/X용 글 (300자 이내)"},
                "summary": {"type": "string", "description": "3줄 요약"},
            },
            "required": ["threads", "summary"],
            "additionalProperties": False,
        },
    },
    "required": ["title_candidates", "keywords", "hook_pattern", "tags", "thumbnail_text", "body_markdown", "sns"],
    "additionalProperties": False,
}

CHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "result": {"type": "string", "enum": ["pass", "gap", "na"]},
                    "evidence": {"type": "string", "description": "pass: 인용 문장 / gap: 보완 방법 / na: 이유"},
                },
                "required": ["id", "result", "evidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}


def load_ai_config() -> dict:
    cfg = dict(DEFAULT_AI)
    path = BASE_DIR / "config.json"
    if path.exists():
        cfg.update(json.loads(path.read_text(encoding="utf-8")).get("ai", {}))
    return cfg


def _call(client: anthropic.Anthropic, cfg: dict, system: str, user: str, schema: dict,
          effort: str | None = None) -> dict:
    with client.beta.messages.stream(
        model=cfg["model"],
        max_tokens=64000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={
            "effort": effort or cfg["effort"],
            "format": {"type": "json_schema", "schema": schema},
        },
        # 안전 분류기 거절 시 서버에서 대체 모델로 자동 재시도
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()

    if msg.stop_reason == "refusal":
        raise RuntimeError(f"모델이 작성 거절: {getattr(msg.stop_details, 'explanation', '')}")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("출력 길이 초과로 중단됨")
    text = next((b.text for b in msg.content if b.type == "text"), "")
    u = msg.usage
    print(f"  토큰: 입력 {u.input_tokens:,} / 출력 {u.output_tokens:,}")
    return json.loads(text)


def _request(cfg: dict, topic: str, extra: str, history: list) -> str:
    user = (f"주제: {topic}\n분량: 본문 {cfg['min_chars']}자 이상\n"
            f"제목 후보: {cfg['title_candidates']}개")
    if extra:
        user += f"\n추가 요청: {extra}"
    hooks = [h.get("hook") for h in history[-5:] if h.get("hook")]
    if hooks:
        user += f"\n최근 글에서 쓴 훅 패턴 (이번엔 다른 패턴 사용): {', '.join(hooks)}"
    kws = [h.get("keyword") for h in history if h.get("keyword")]
    if kws:
        user += f"\n이미 다룬 핵심 키워드 (같은 키워드로 겹치지 않게): {', '.join(kws[-15:])}"
    return user


def write_article(client: anthropic.Anthropic, cfg: dict, topic: str, extra: str = "") -> dict:
    system = prompts.build_system(cfg.get("style_prompt", ""))
    request = _request(cfg, topic, extra, quality.load_history())
    data = _call(client, cfg, system, request, SCHEMA)
    data["body_markdown"] = quality.clean_text(data["body_markdown"])
    report = {"revised": False, "issues": quality.check_body(data["body_markdown"])}

    # 1) 문체 검사 → 문제 있으면 1회 자동 수정
    fixes = [i["msg"] for i in report["issues"] if i["level"] == "fix"]
    if cfg.get("quality_gate") and fixes:
        print(f"  문체 문제 {len(fixes)}건 → 자동 수정")
        fix_req = (request + "\n\n아래 초안의 문제만 고쳐서 같은 JSON 형식으로 다시 작성. "
                   "문제 외 내용은 유지.\n문제:\n- " + "\n- ".join(fixes) +
                   "\n\n초안:\n" + json.dumps(data, ensure_ascii=False))
        data = _call(client, cfg, system, fix_req, SCHEMA)
        data["body_markdown"] = quality.clean_text(data["body_markdown"])
        report = {"revised": True, "issues": quality.check_body(data["body_markdown"])}

    # 2) 제목 후보 자동 순위
    ranked = quality.rank_titles(data["title_candidates"])
    if not ranked:
        raise RuntimeError("제목 후보 없음")
    data["title"] = ranked[0]["title"]
    report["titles"] = ranked

    # 3) 15개 항목 자체 점검
    report["check"] = []
    if cfg.get("self_check"):
        items = "\n".join(f"{i}. [{k}] {q}" for i, k, q in prompts.SELF_CHECK_ITEMS)
        res = _call(client, cfg, prompts.SELF_CHECK_SYSTEM,
                    f"점검 항목:\n{items}\n\n제목: {data['title']}\n\n초안:\n{data['body_markdown']}",
                    CHECK_SCHEMA, effort="low")
        report["check"] = res.get("items", [])
    report["honesty_gap"] = [c for c in report["check"]
                             if c["id"] in prompts.HONESTY_ITEMS and c["result"] == "gap"]
    data["_report"] = report
    return data


def next_slots(posts_dir: Path, n: int, sched: dict) -> list:
    """예약 시간대 자동 배정: 설정 slots(기본 09:00) 중 비어 있는 가장 빠른 칸부터 n개"""
    import tistory_poster as tp
    cfg = {"timezone": sched.get("timezone", "Asia/Seoul"), "default_visibility": "public",
           "posts_dir": posts_dir}
    taken = set()
    if posts_dir.exists():
        for f in tp.pending_posts(cfg, due_only=False):
            try:
                w = tp.parse_post(f, cfg).publish_at
            except Exception:
                continue
            if w:
                taken.add(w.strftime("%Y-%m-%d %H:%M"))
    slots = sorted(sched.get("slots") or ["09:00"])
    skip_days = {int(x) for x in sched.get("skip_weekdays", [])}  # 0=월 ... 6=일
    start = tp.now(cfg) + dt.timedelta(minutes=30)
    out, day = [], start.date()
    while len(out) < n and day <= start.date() + dt.timedelta(days=366):
        if day.weekday() not in skip_days:
            for hm in slots:
                h, m = map(int, hm.split(":"))
                w = dt.datetime(day.year, day.month, day.day, h, m, tzinfo=start.tzinfo)
                key = w.strftime("%Y-%m-%d %H:%M")
                if w >= start and key not in taken:
                    taken.add(key)
                    out.append(key)
                    if len(out) == n:
                        break
        day += dt.timedelta(days=1)
    return out


def save_post(data: dict, posts_dir: Path, category: str, visibility: str, publish_at: str = "") -> Path:
    posts_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^\w가-힣]+", "_", data["title"]).strip("_")[:40]
    path = posts_dir / f"{stamp}_{slug}.md"
    n = 2
    while path.exists():  # 같은 초·같은 제목이면 덮어쓰지 않도록 번호 붙임
        path = posts_dir / f"{stamp}_{slug}_{n}.md"
        n += 1
    tags = ", ".join(t.replace(",", " ").strip().lstrip("#") for t in data["tags"] if t.strip())
    title = data["title"].replace("\n", " ").strip()
    kw = data.get("keywords", {})
    one = lambda v: str(v).replace("\n", " ").strip()
    path.write_text(
        f"---\ntitle: {title}\ncategory: {category}\ntags: {tags}\n"
        f"visibility: {visibility}\n"
        f"keyword: {one(kw.get('main', ''))}\nsub_keywords: {one(', '.join(kw.get('sub', [])))}\n"
        f"hook: {one(data.get('hook_pattern', ''))}\n"
        f"thumbnail_text: {one(data.get('thumbnail_text', ''))}\n"
        + (f"publish_at: {publish_at}\n" if publish_at else "")
        + f"---\n\n{data['body_markdown'].strip()}\n",
        encoding="utf-8",
    )
    quality.append_history({"date": stamp, "title": title, "keyword": kw.get("main", ""),
                            "hook": data.get("hook_pattern", ""), "file": path.name})
    return path


def write_summary(topic: str, data: dict, path: Path, visibility: str):
    """GitHub Actions 실행 화면 요약 (휴대폰 앱에서 확인)"""
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if not out:
        return
    r = data["_report"]
    L = [f"### ✍️ {data['title']}",
         f"- 주제: {topic} / 공개범위: {visibility} / 발행: {data.get('_publish_at') or '즉시'}",
         f"- 썸네일 문구: {data.get('thumbnail_text', '')}",
         f"- 핵심 키워드: {data['keywords']['main']} / 훅: {data.get('hook_pattern', '')}"]
    if r["honesty_gap"]:
        L.append("- ⚠️ **정직성 점검 미달 → 비공개로 발행됨. 검토 후 공개 전환 필요**")
    L += ["", "<details><summary>제목 후보 점수</summary>", "", "| 점수 | 제목 | 지적 |", "|---|---|---|"]
    L += [f"| {t['score']} | {t['title']} | {'; '.join(t['issues'][:2])} |" for t in r["titles"][:5]]
    L += ["", "</details>"]
    if r["check"]:
        mark = {"pass": "✅", "gap": "⚠️", "na": "➖"}
        L += ["", "<details><summary>15개 항목 자체 점검 (네이버 AI 브리핑 공식 가이드 기준)</summary>", "",
              "| 항목 | 결과 | 근거 |", "|---|---|---|"]
        L += [f"| {c['id']} | {mark.get(c['result'], c['result'])} | {c['evidence'][:80].replace('|', '/')} |"
              for c in r["check"]]
        L += ["", "</details>"]
    if r["issues"]:
        L += ["", f"- 문체 검사{' (자동 수정 후)' if r['revised'] else ''}: " +
              "; ".join(i["msg"] for i in r["issues"])]
    if data.get("sns"):
        L += ["", "<details><summary>📱 SNS용 글 (복사해서 Threads 등에 게시)</summary>", "",
              "**Threads**", "", "```", data["sns"]["threads"], "```", "", "**3줄 요약**", "",
              "```", data["sns"]["summary"], "```", "", "</details>"]
    with open(out, "a", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n\n")


def save_sns(data: dict, path: Path):
    """SNS 초안 파일 (posts/ 밖 sns/ 폴더, 발행 대상 아님)"""
    if not data.get("sns"):
        return
    d = BASE_DIR / "sns"
    d.mkdir(exist_ok=True)
    (d / (path.stem + ".txt")).write_text(
        f"[원문] {data['title']}\n\n[Threads]\n{data['sns']['threads']}\n\n[3줄 요약]\n{data['sns']['summary']}\n",
        encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Claude API 블로그 글 자동 작성")
    ap.add_argument("topics", nargs="*", help="글 주제 (여러 개 가능)")
    ap.add_argument("--topics-file", help="주제 목록 파일 (한 줄 = 한 주제)")
    ap.add_argument("--count", type=int, default=0, help="topics-file 에서 처리할 개수 (0=전부)")
    ap.add_argument("--category", default="", help="카테고리명")
    ap.add_argument("--visibility", default="", help="public / protected / private")
    ap.add_argument("--extra", default="", help="추가 요청사항 (예: 초보자 대상, 코드 예시 포함)")
    ap.add_argument("--publish", action="store_true", help="작성 직후 티스토리 발행")
    ap.add_argument("--publish-at", default="",
                    help="예약 발행: 'auto' = 빈 시간대 자동 배정, '2026-11-05 09:00' = 지정 시각, 비우면 즉시")
    args = ap.parse_args()

    cfg = load_ai_config()
    topics = list(args.topics)
    tf = Path(args.topics_file) if args.topics_file else None
    if tf:
        lines = [l.strip() for l in tf.read_text(encoding="utf-8").splitlines()]
        file_topics = [l for l in lines if l and not l.startswith("#")]
        if args.count:
            file_topics = file_topics[: args.count]
        topics += file_topics
    if not topics:
        ap.error("주제 입력 필요 (인자 또는 --topics-file)")

    main_cfg = {}
    if (BASE_DIR / "config.json").exists():
        main_cfg = json.loads((BASE_DIR / "config.json").read_text(encoding="utf-8"))
    posts_dir = (BASE_DIR / main_cfg.get("posts_dir", "./posts")).resolve()
    category = args.category or main_cfg.get("default_category", "")
    visibility = args.visibility or main_cfg.get("default_visibility", "public")

    # 예약 시각 결정
    sched = dict(main_cfg.get("schedule", {}))
    if os.environ.get("SCHEDULE_SLOTS"):  # GitHub Actions: 저장소 Variables 로 시간대 지정 (예: 09:00,19:00)
        sched["slots"] = [x.strip() for x in os.environ["SCHEDULE_SLOTS"].split(",") if x.strip()]
    when = args.publish_at.strip()
    if when.lower() == "auto":
        slots = next_slots(posts_dir, len(topics), sched)
    elif when and when not in ("now", "즉시"):
        import tistory_poster as tp
        w = tp.parse_when(when, sched)
        slots = [(w + dt.timedelta(hours=i * int(sched.get("gap_hours", 24)))).strftime("%Y-%m-%d %H:%M")
                 for i in range(len(topics))]
    else:
        slots = [""] * len(topics)

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용
    saved, done = [], []
    for i, topic in enumerate(topics, 1):
        print(f"[{i}/{len(topics)}] 작성 중: {topic}")
        try:
            data = write_article(client, cfg, topic, args.extra)
            vis = visibility
            if data["_report"]["honesty_gap"]:
                vis = "private"
                print("  ⚠️ 정직성 점검 미달 → 비공개로 저장 (검토 후 공개 전환 필요)")
            data["_publish_at"] = slots[i - 1] if i - 1 < len(slots) else ""
            path = save_post(data, posts_dir, category, vis, data["_publish_at"])
            if cfg.get("sns"):
                save_sns(data, path)
            write_summary(topic, data, path, vis)
            best = data["_report"]["titles"][0]
            print(f"  저장: {path.name}  (제목: {data['title']}, 제목 점수 {best['score']}, "
                  f"발행: {data['_publish_at'] or '즉시'})")
            saved.append(path)
            done.append(topic)
        except (anthropic.AuthenticationError, TypeError):
            # TypeError: 인증 정보 미설정 시 SDK 가 발생
            sys.exit("[오류] API 키 확인 필요 (환경변수 ANTHROPIC_API_KEY)")
        except anthropic.RateLimitError:
            print("  [중단] 요청 한도 초과 → 잠시 후 재실행")
            break
        except (anthropic.APIStatusError, anthropic.APIConnectionError, RuntimeError, json.JSONDecodeError) as e:
            print(f"  [실패] {e}")

    # 작성 완료된 주제는 topics 파일에서 제거
    if tf and done:
        remain = [l for l in tf.read_text(encoding="utf-8").splitlines() if l.strip() not in done]
        tf.write_text("\n".join(remain) + ("\n" if remain else ""), encoding="utf-8")

    print(f"완료: {len(saved)}/{len(topics)} 건 작성")
    if args.publish and saved:
        import tistory_poster as tp
        tp.setup_logging()
        tp.run_once(tp.load_config(), saved)


if __name__ == "__main__":
    main()
