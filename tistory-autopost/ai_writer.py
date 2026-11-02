"""
Claude API 기반 블로그 본문 자동 작성기

주제 → Claude 가 제목·태그·본문(마크다운) 작성 → posts/ 에 .md 저장
→ tistory_poster.py 가 그대로 발행

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
import re
import sys
from pathlib import Path

import anthropic

BASE_DIR = Path(__file__).resolve().parent

DEFAULT_AI = {
    "model": "claude-opus-5-5",
    "effort": "medium",
    "min_chars": 2000,
    "style_prompt": (
        "너는 한국어 티스토리 블로그 전문 작가다. 독자가 검색으로 유입되는 정보성 글을 쓴다.\n"
        "- 도입부에서 글을 읽어야 하는 이유를 2~3문장으로 제시\n"
        "- ## / ### 소제목으로 구조화, 필요 시 표·목록 활용\n"
        "- 사실 위주로 쓰고, 확실하지 않은 수치·날짜는 단정하지 말 것\n"
        "- 마지막에 핵심 요약 섹션 포함\n"
        "- 과장된 광고 문구, 이모지 남발 금지"
    ),
}

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "검색 친화적 글 제목 (60자 이내)"},
        "tags": {"type": "array", "items": {"type": "string"}, "description": "태그 5~10개"},
        "body_markdown": {"type": "string", "description": "본문 마크다운 (제목 H1 제외)"},
    },
    "required": ["title", "tags", "body_markdown"],
    "additionalProperties": False,
}


def load_ai_config() -> dict:
    cfg = dict(DEFAULT_AI)
    path = BASE_DIR / "config.json"
    if path.exists():
        cfg.update(json.loads(path.read_text(encoding="utf-8")).get("ai", {}))
    return cfg


def write_article(client: anthropic.Anthropic, cfg: dict, topic: str, extra: str = "") -> dict:
    user = f"주제: {topic}\n분량: 본문 {cfg['min_chars']}자 이상"
    if extra:
        user += f"\n추가 요청: {extra}"

    with client.beta.messages.stream(
        model=cfg["model"],
        max_tokens=64000,
        system=cfg["style_prompt"],
        messages=[{"role": "user", "content": user}],
        output_config={
            "effort": cfg["effort"],
            "format": {"type": "json_schema", "schema": SCHEMA},
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
    data = json.loads(text)
    u = msg.usage
    print(f"  토큰: 입력 {u.input_tokens:,} / 출력 {u.output_tokens:,}")
    return data


def save_post(data: dict, posts_dir: Path, category: str, visibility: str) -> Path:
    posts_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^\w가-힣]+", "_", data["title"]).strip("_")[:40]
    path = posts_dir / f"{stamp}_{slug}.md"
    tags = ", ".join(t.replace(",", " ").strip().lstrip("#") for t in data["tags"] if t.strip())
    title = data["title"].replace("\n", " ").strip()
    path.write_text(
        f"---\ntitle: {title}\ncategory: {category}\ntags: {tags}\n"
        f"visibility: {visibility}\n---\n\n{data['body_markdown'].strip()}\n",
        encoding="utf-8",
    )
    return path


def main():
    ap = argparse.ArgumentParser(description="Claude API 블로그 글 자동 작성")
    ap.add_argument("topics", nargs="*", help="글 주제 (여러 개 가능)")
    ap.add_argument("--topics-file", help="주제 목록 파일 (한 줄 = 한 주제)")
    ap.add_argument("--count", type=int, default=0, help="topics-file 에서 처리할 개수 (0=전부)")
    ap.add_argument("--category", default="", help="카테고리명")
    ap.add_argument("--visibility", default="", help="public / protected / private")
    ap.add_argument("--extra", default="", help="추가 요청사항 (예: 초보자 대상, 코드 예시 포함)")
    ap.add_argument("--publish", action="store_true", help="작성 직후 티스토리 발행")
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

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용
    saved, done = [], []
    for i, topic in enumerate(topics, 1):
        print(f"[{i}/{len(topics)}] 작성 중: {topic}")
        try:
            data = write_article(client, cfg, topic, args.extra)
            path = save_post(data, posts_dir, category, visibility)
            print(f"  저장: {path.name}  (제목: {data['title']})")
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
