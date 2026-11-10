"""
블로그 운영 도우미: 성과 리포트 · 댓글 관리 · 오래된 글 갱신 제안

  python insights.py report     # 성과 리포트 (티스토리 통계 + 발행 이력 분석)
  python insights.py comments   # 새 댓글 분류(답변/숨김/글감/무시) + 답글 초안
  python insights.py refresh    # 오래된 글에서 바뀌었을 수 있는 정보 찾기 + 수정안
  python insights.py all        # 위 3개 모두 (주간 실행용)

방식 (Uplika performance-review / comments / naver-ai-cite 스킬 기반, MIT)
  - 아무것도 자동으로 게시·수정하지 않음. 결과는 Actions 요약 화면과 reports/ 에 남김
  - 글감 제안은 topics.txt 에 '# ' 주석으로 추가 → 휴대폰에서 '# ' 만 지우면 다음 작성 대상
  - 통계·댓글은 관리 화면 글자를 그대로 읽어 Claude 가 정리 (화면 구조가 바뀌어도 동작)
  - 오래된 글은 공개 사이트맵·글 페이지만 사용 (로그인 불필요)
"""

import argparse
import datetime as dt
import json
import os
import re
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

BASE_DIR = Path(__file__).resolve().parent
REPORT_DIR = BASE_DIR / "reports"
REFRESH_STATE = BASE_DIR / "refresh_state.json"
TOPICS = BASE_DIR / "topics.txt"
UA = {"User-Agent": "Mozilla/5.0 (compatible; tistory-autopost)"}
MAX_TEXT = 12000

# ---------------------------------------------------------------- 공개 데이터 (로그인 불필요)


def _get(url: str, timeout=20) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def sitemap_posts(blog: str) -> list:
    """사이트맵의 글 주소 목록 [(url, lastmod datetime|None)]"""
    xml = _get(f"https://{blog}.tistory.com/sitemap.xml")
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    out = []
    for u in ET.fromstring(xml).findall("s:url", ns):
        loc = (u.findtext("s:loc", default="", namespaces=ns) or "").strip()
        path = re.sub(r"^https?://[^/]+", "", loc)
        if not re.match(r"^/(\d+|entry/.+)$", path):
            continue
        lm = u.findtext("s:lastmod", default="", namespaces=ns)
        try:
            lm = dt.datetime.fromisoformat(lm) if lm else None
        except ValueError:
            lm = None
        out.append((loc, lm))
    return out


def fetch_post(url: str) -> dict:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(_get(url), "html.parser")
    meta = lambda p: (soup.find("meta", attrs={"property": p}) or {}).get("content", "")
    body = (soup.select_one(".contents_style") or soup.select_one(".entry-content")
            or soup.select_one("article") or soup.body)
    for t in body.select("script, style, .another_category, .container_postbtn, .revenue_unit_wrap"):
        t.decompose()
    text = re.sub(r"\n{3,}", "\n\n", body.get_text("\n", strip=True))
    return {"url": url, "title": meta("og:title") or (soup.title.string if soup.title else url),
            "published": meta("article:published_time"), "modified": meta("article:modified_time"),
            "text": text}


# ---------------------------------------------------------------- 관리 화면 (로그인 필요)


def manage_pages(bot, keywords: list, limit: int = 4) -> list:
    """관리 화면 메뉴에서 키워드가 들어간 링크를 찾아 각 화면의 글자를 수집 [(이름, url, 본문)]"""
    from selenium.webdriver.common.by import By
    import time
    d = bot.d
    d.get(bot.manage_url)
    time.sleep(3)
    links, seen = [], set()
    for a in d.find_elements(By.CSS_SELECTOR, "a[href*='/manage/']"):
        try:
            text, href = a.text.strip(), a.get_attribute("href") or ""
        except Exception:
            continue
        if text and href not in seen and any(k in text for k in keywords):
            seen.add(href)
            links.append((text, href))
    out = []
    for name, href in links[:limit]:
        try:
            d.get(href)
            time.sleep(4)
            out.append((name, href.split("?")[0], bot._page_text()[:MAX_TEXT]))
        except Exception as e:
            out.append((name, href, f"(읽기 실패: {e})"))
    return out


def login_bot():
    import tistory_poster as tp
    cfg = tp.load_config()
    bot = tp.TistoryBot(cfg)
    if bot.is_logged_in():
        return cfg, bot
    bot.close()
    return cfg, None


# ---------------------------------------------------------------- 공통


def claude():
    import anthropic
    import ai_writer
    return anthropic.Anthropic(), ai_writer.load_ai_config(), ai_writer._call


def summary(md: str):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(md.rstrip() + "\n\n")


def save_report(name: str, md: str) -> Path:
    REPORT_DIR.mkdir(exist_ok=True)
    p = REPORT_DIR / f"{dt.date.today():%Y%m%d}_{name}.md"
    p.write_text(md, encoding="utf-8")
    return p


def add_topic_ideas(ideas: list, source: str) -> int:
    """글감을 topics.txt 에 '# ' 주석으로 추가 (중복 제외). 휴대폰에서 '# ' 을 지우면 작성 대상이 됨"""
    ideas = [re.sub(r"\s+", " ", i).strip(" #") for i in ideas if i and i.strip()]
    if not ideas:
        return 0
    cur = TOPICS.read_text(encoding="utf-8") if TOPICS.exists() else ""
    have = {l.strip().lstrip("#").strip() for l in cur.splitlines()}
    new = [i for i in dict.fromkeys(ideas) if i not in have]  # 같은 실행 안 중복도 제거
    if not new:
        return 0
    block = f"\n# --- {source} 제안 {dt.date.today():%m/%d} (쓰려면 줄 앞 '# ' 삭제) ---\n" + \
        "\n".join(f"# {i}" for i in new) + "\n"
    TOPICS.write_text(cur.rstrip("\n") + "\n" + block, encoding="utf-8")
    return len(new)


def _cell(s, n=70) -> str:
    return str(s).replace("|", "/").replace("\n", " ")[:n]


# ---------------------------------------------------------------- 1. 성과 리포트

REPORT_SYSTEM = """\
너는 블로그 성과 분석가다. 주어진 티스토리 관리 화면 글자(통계)와 발행 이력으로 주간 리포트를 쓴다.
규칙 (Uplika performance-review 방식):
- 각 글은 이 블로그 자체의 중앙값과 비교. 업계 평균·남의 블로그 기준을 지어내지 말 것
- 값이 없는 지표는 0이 아니라 '데이터 없음'. 화면에 없는 숫자를 만들지 말 것
- 글 1개의 결과는 일화일 뿐 → 패턴은 여러 글에서 반복될 때만 말함
- 잘된 글과 안된 글의 구체적 차이(제목 형태, 훅 패턴, 키워드, 길이, 발행 요일·시간)를 짚을 것
- '최적 발행 시간'은 이 블로그의 실제 기록으로 뒷받침될 때만 언급
- 유입 검색어가 보이면 아직 글이 없는 검색어를 글감으로 제안
- 다음 주에 바로 할 일 3개 이내, 실무적으로"""

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string", "description": "이번 주 한 줄 요약"},
        "metrics": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "value": {"type": "string"}, "note": {"type": "string"}},
            "required": ["name", "value", "note"], "additionalProperties": False}},
        "top_posts": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "metric": {"type": "string"}, "why": {"type": "string"}},
            "required": ["title", "metric", "why"], "additionalProperties": False}},
        "weak_posts": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "metric": {"type": "string"}, "why": {"type": "string"}},
            "required": ["title", "metric", "why"], "additionalProperties": False}},
        "patterns": {"type": "array", "items": {"type": "string"}},
        "topic_ideas": {"type": "array", "items": {"type": "string"}, "description": "새 글 주제 (topics.txt 한 줄 형식)"},
        "next_actions": {"type": "array", "items": {"type": "string"}},
        "data_gaps": {"type": "array", "items": {"type": "string"}, "description": "확인 못 한 데이터"},
    },
    "required": ["headline", "metrics", "top_posts", "weak_posts", "patterns", "topic_ideas",
                 "next_actions", "data_gaps"],
    "additionalProperties": False,
}


def cmd_report(bot, cfg, add_ideas=True) -> str:
    pages = manage_pages(bot, ["통계", "방문", "유입", "인기"]) if bot else []
    hist = []
    hp = BASE_DIR / "history.jsonl"
    if hp.exists():
        for line in hp.read_text(encoding="utf-8").splitlines()[-40:]:
            try:
                hist.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    try:
        posts = sitemap_posts(cfg["blog_name"])
    except Exception as e:
        posts = []
        print(f"사이트맵 읽기 실패: {e}")
    recent = sorted([p for p in posts if p[1]], key=lambda x: x[1], reverse=True)[:30]

    parts = [f"기준일: {dt.date.today()} / 블로그: {cfg['blog_name']}.tistory.com",
             f"공개 글 수(사이트맵): {len(posts)}",
             "최근 수정·발행 글 날짜: " + ", ".join(f"{p[1]:%m/%d %a %H시}" for p in recent[:20])]
    if hist:
        parts.append("발행 이력 (제목 / 핵심 키워드 / 훅 패턴):\n" + "\n".join(
            f"- {h.get('date', '')[:8]} {h.get('title', '')} / {h.get('keyword', '')} / {h.get('hook', '')}"
            for h in hist))
    if pages:
        parts += [f"[관리 화면: {n}] {u}\n{t}" for n, u, t in pages]
    else:
        parts.append("(로그인 실패 또는 통계 화면 없음 → 통계 수치 없음)")

    client, acfg, call = claude()
    r = call(client, acfg, REPORT_SYSTEM, "\n\n".join(parts), REPORT_SCHEMA, effort="medium")

    L = [f"## 📊 주간 성과 리포트 ({dt.date.today():%Y-%m-%d})", "", f"**{r['headline']}**", ""]
    if r["metrics"]:
        L += ["| 지표 | 값 | 비고 |", "|---|---|---|"] + [
            f"| {_cell(m['name'])} | {_cell(m['value'])} | {_cell(m['note'])} |" for m in r["metrics"]] + [""]
    for label, key in (("👍 잘된 글", "top_posts"), ("👎 아쉬운 글", "weak_posts")):
        if r[key]:
            L += [f"**{label}**", "", "| 제목 | 지표 | 이유 |", "|---|---|---|"] + [
                f"| {_cell(p['title'], 40)} | {_cell(p['metric'], 20)} | {_cell(p['why'], 90)} |"
                for p in r[key]] + [""]
    for label, key in (("패턴", "patterns"), ("다음 주 할 일", "next_actions"),
                       ("글감 제안", "topic_ideas"), ("확인 못 한 데이터", "data_gaps")):
        if r[key]:
            L += [f"**{label}**", ""] + [f"- {x}" for x in r[key]] + [""]
    if add_ideas:
        n = add_topic_ideas(r["topic_ideas"], "성과 리포트")
        if n:
            L.append(f"→ 글감 {n}개를 `topics.txt`에 주석으로 추가함 (쓰려면 줄 앞 `# ` 삭제)")
    md = "\n".join(L)
    save_report("report", md)
    summary(md)
    return r["headline"]


# ---------------------------------------------------------------- 2. 댓글 관리

COMMENT_SYSTEM = """\
너는 블로그 댓글 담당자다. 관리 화면 글자에서 댓글을 찾아 분류하고 답글 초안을 쓴다.
분류 (Uplika comments 방식):
- answer: 질문·요청·오류 제보 → 답글 필요. 글 내용으로 답할 수 없으면 확인 후 답하겠다고 정직하게
- hide: 스팸·광고·욕설·개인정보 노출 → 숨김/삭제 권장
- idea: 새 글로 다룰 만한 질문·요청 → topic_idea 에 글 주제 한 줄
- ignore: 인사·단순 감사 등 (짧은 감사 답글은 선택)
규칙: 답글은 블로그 주인 말투로 짧고 구체적으로, 지어낸 경험·약속 금지, 자동 게시하지 않음 (초안만).
화면에 댓글이 없거나 읽을 수 없으면 comments 를 비우고 note 에 이유."""

COMMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "comments": {"type": "array", "items": {"type": "object", "properties": {
            "author": {"type": "string"}, "post": {"type": "string"}, "excerpt": {"type": "string"},
            "category": {"type": "string", "enum": ["answer", "hide", "idea", "ignore"]},
            "reply_draft": {"type": "string"}, "topic_idea": {"type": "string"}},
            "required": ["author", "post", "excerpt", "category", "reply_draft", "topic_idea"],
            "additionalProperties": False}},
        "note": {"type": "string"},
    },
    "required": ["comments", "note"],
    "additionalProperties": False,
}


def cmd_comments(bot, cfg, add_ideas=True) -> str:
    if not bot:
        summary("## 💬 댓글 관리\n- 로그인 안 됨 → 건너뜀 (`로그인 점검` 실행 필요)")
        return "댓글: 로그인 필요"
    pages = manage_pages(bot, ["댓글"], limit=2)
    if not pages:
        summary("## 💬 댓글 관리\n- 관리 화면에서 댓글 메뉴를 찾지 못함")
        return "댓글: 메뉴 없음"
    client, acfg, call = claude()
    r = call(client, acfg, COMMENT_SYSTEM,
             "\n\n".join(f"[관리 화면: {n}] {u}\n{t}" for n, u, t in pages), COMMENT_SCHEMA, effort="low")
    cs = r["comments"]
    icon = {"answer": "💬 답변", "hide": "🚫 숨김", "idea": "💡 글감", "ignore": "➖ 무시"}
    L = [f"## 💬 댓글 관리 ({len(cs)}건)", ""]
    if not cs:
        L.append(f"- {r['note'] or '새 댓글 없음'}")
    for cat in ("answer", "idea", "hide", "ignore"):
        rows = [c for c in cs if c["category"] == cat]
        if not rows:
            continue
        L += [f"**{icon[cat]} {len(rows)}건**", ""]
        for c in rows:
            L.append(f"- **{_cell(c['author'], 20)}** · {_cell(c['post'], 30)}: {_cell(c['excerpt'], 100)}")
            if c["reply_draft"] and cat in ("answer", "idea", "ignore"):
                L += ["  ```", "  " + c["reply_draft"].replace("\n", "\n  "), "  ```"]
        L.append("")
    L.append("> 답글은 자동 게시하지 않음 → 티스토리 앱 댓글 관리에서 초안을 붙여 넣어 답글")
    if add_ideas:
        n = add_topic_ideas([c["topic_idea"] for c in cs if c["category"] == "idea"], "댓글")
        if n:
            L.append(f"→ 글감 {n}개를 `topics.txt`에 주석으로 추가함")
    md = "\n".join(L)
    save_report("comments", md)
    summary(md)
    need = sum(1 for c in cs if c["category"] in ("answer", "hide"))
    return f"댓글 {len(cs)}건 (답변·숨김 필요 {need}건)"


# ---------------------------------------------------------------- 3. 오래된 글 갱신 제안

REFRESH_SYSTEM = """\
너는 블로그 편집자다. 오래된 글들에서 시간이 지나 틀렸을 수 있는 정보를 찾는다 (네이버 가이드 '최신성 유지' 원칙).
찾을 것: 가격·요금, 날짜·기한, 제품·프로그램 버전, 법·제도·지원사업 기준, 서비스 존재 여부, '올해/최근/현재' 같은 상대 시점.
규칙:
- 새 사실을 지어내지 말 것. 무엇이 바뀌었는지 모르면 suggestion 에 '확인 필요: 무엇을 어디서 확인' 으로 씀
- quote 는 글에 실제로 있는 문장 그대로
- 시점이 중요하지 않은 글(원리·개념 설명)은 needs_update=false
- 기준 시점 문구('2026년 11월 기준') 추가 제안 가능"""

REFRESH_SCHEMA = {
    "type": "object",
    "properties": {
        "posts": {"type": "array", "items": {"type": "object", "properties": {
            "url": {"type": "string"}, "title": {"type": "string"}, "needs_update": {"type": "boolean"},
            "priority": {"type": "string", "enum": ["high", "medium", "low"]},
            "issues": {"type": "array", "items": {"type": "object", "properties": {
                "quote": {"type": "string"}, "problem": {"type": "string"}, "suggestion": {"type": "string"}},
                "required": ["quote", "problem", "suggestion"], "additionalProperties": False}}},
            "required": ["url", "title", "needs_update", "priority", "issues"], "additionalProperties": False}},
    },
    "required": ["posts"],
    "additionalProperties": False,
}


def cmd_refresh(cfg, n: int = 5, min_age_days: int = 180, recheck_days: int = 90) -> str:
    try:
        posts = sitemap_posts(cfg["blog_name"])
    except Exception as e:
        summary(f"## 🔄 오래된 글 점검\n- 사이트맵 읽기 실패: {e}")
        return "갱신 점검: 사이트맵 실패"
    state = json.loads(REFRESH_STATE.read_text(encoding="utf-8")) if REFRESH_STATE.exists() else {}
    today = dt.datetime.now(dt.timezone.utc)
    cutoff, recheck = today - dt.timedelta(days=min_age_days), today - dt.timedelta(days=recheck_days)

    def checked_recently(url):
        t = state.get(url)
        return t and dt.datetime.fromisoformat(t) > recheck

    old = [(u, lm) for u, lm in posts if lm and lm < cutoff and not checked_recently(u)]
    old.sort(key=lambda x: x[1])  # 가장 오래 손대지 않은 글부터
    picked = old[:n]
    if not picked:
        summary(f"## 🔄 오래된 글 점검\n- {min_age_days}일 이상 지난 미점검 글 없음")
        return "갱신 점검: 대상 없음"

    docs = []
    for u, lm in picked:
        try:
            p = fetch_post(u)
            docs.append(f"[URL] {u}\n[제목] {p['title']}\n[작성] {p['published'][:10]} [수정] {lm:%Y-%m-%d}\n"
                        f"{p['text'][:6000]}")
        except Exception as e:
            print(f"글 읽기 실패 {u}: {e}")
        state[u] = today.isoformat()
    client, acfg, call = claude()
    r = call(client, acfg, REFRESH_SYSTEM, f"오늘: {dt.date.today()}\n\n" + "\n\n=====\n\n".join(docs),
             REFRESH_SCHEMA, effort="medium")
    REFRESH_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=0), encoding="utf-8")

    need = [p for p in r["posts"] if p["needs_update"]]
    pr = {"high": 0, "medium": 1, "low": 2}
    need.sort(key=lambda p: pr.get(p["priority"], 3))
    L = [f"## 🔄 오래된 글 점검 ({len(docs)}개 중 갱신 권장 {len(need)}개)", ""]
    for p in need:
        L += [f"**[{p['priority'].upper()}] [{_cell(p['title'], 50)}]({p['url']})**", ""]
        for i in p["issues"]:
            L += [f"- 원문: \"{_cell(i['quote'], 120)}\"", f"  - 문제: {i['problem']}", f"  - 제안: {i['suggestion']}"]
        L.append("")
    ok = [p for p in r["posts"] if not p["needs_update"]]
    if ok:
        L.append("갱신 불필요: " + ", ".join(_cell(p["title"], 30) for p in ok))
    L.append("\n> 자동 수정하지 않음 → 티스토리 앱에서 해당 글 수정. 다음 주에 다른 글 5개 점검 (같은 글은 90일 후 재점검)")
    md = "\n".join(L)
    save_report("refresh", md)
    summary(md)
    return f"갱신 권장 {len(need)}개"


# ---------------------------------------------------------------- 실행


def main():
    ap = argparse.ArgumentParser(description="블로그 운영 도우미")
    ap.add_argument("command", choices=["report", "comments", "refresh", "all"])
    ap.add_argument("--no-ideas", action="store_true", help="글감을 topics.txt 에 추가하지 않음")
    ap.add_argument("--refresh-count", type=int, default=5)
    ap.add_argument("--min-age-days", type=int, default=180)
    a = ap.parse_args()

    import tistory_poster as tp
    tp.setup_logging()
    results, bot = [], None
    cfg = tp.load_config()
    try:
        if a.command in ("report", "comments", "all"):
            cfg, bot = login_bot()
            if not bot:
                print("로그인 실패 → 통계·댓글은 공개 정보만 사용")
        steps = {"report": lambda: cmd_report(bot, cfg, not a.no_ideas),
                 "comments": lambda: cmd_comments(bot, cfg, not a.no_ideas),
                 "refresh": lambda: cmd_refresh(cfg, a.refresh_count, a.min_age_days)}
        for name in (["report", "comments", "refresh"] if a.command == "all" else [a.command]):
            try:
                results.append(steps[name]())
            except Exception as e:  # 하나가 실패해도 나머지 진행
                print(f"[{name}] 실패: {e}")
                summary(f"## ⚠️ {name} 실패\n- {e}")
                results.append(f"{name} 실패")
    finally:
        if bot:
            bot.close()
    try:
        import notify
        notify.send("블로그 주간 점검", "\n".join(results))
    except Exception:
        pass
    print("\n".join(results))


if __name__ == "__main__":
    main()
