"""
AI 작성 글 품질 검사 (발행 전 자동 점검)

- 제목 후보 순위: Uplika yt-package title.py (MIT, vendor/uplika/title.py) + 한글 길이 보정
- 보이지 않는 문자 제거: Uplika ig-human humanize.py 의 invisible 처리 방식을 한국어·마크다운 안전하게 재구현
- 한국어 문체 검사: Uplika hooks 한국어 작성 규칙 기반 (강조어·번역투·어미 혼용·문장 길이 단조로움)
"""

import json
import re
import statistics
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR / "vendor" / "uplika"))
from title import check as _title_check  # noqa: E402  (vendor, MIT)

HISTORY = BASE_DIR / "history.jsonl"

# ---------------------------------------------------------------- 텍스트 정리
INVISIBLE = re.compile("[​‌‍⁠﻿­‪-‮⁦-⁩]")
CODE_BLOCK = re.compile(r"(```.*?```|`[^`\n]+`)", re.S)


def clean_text(md: str) -> str:
    """보이지 않는 문자·특수 따옴표 정리 (코드 블록은 그대로 둠, 가운뎃점·화살표·들여쓰기 보존)"""
    def fix(seg: str) -> str:
        seg = INVISIBLE.sub("", seg)
        seg = seg.replace(" ", " ")
        seg = seg.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
        return seg
    parts = CODE_BLOCK.split(md)
    return "".join(p if i % 2 else fix(p) for i, p in enumerate(parts))


# ---------------------------------------------------------------- 제목
KO_ISSUE = {
    "vague": "내용 없는 강조어 → 숫자·대상·날짜로 교체",
    "no-number": "숫자·날짜·고유명사 없음",
    "front-load": "앞 세 단어가 군더더기 → 핵심어를 앞으로",
    "shouting": "대문자 단어 과다",
}


def score_title(title: str) -> dict:
    r = _title_check(title)
    score = r["score"]
    # 길이 판정은 한글 기준으로 따로 함 (vendor 기준은 라틴 문자 60/40자)
    issues = []
    for kind, msg in r["issues"]:
        if kind in ("length", "mobile"):
            score += 14
        else:
            issues.append(KO_ISSUE.get(kind, msg))
    n = len(title)
    if n > 40:  # 한글은 폭이 넓어 모바일 검색 결과에서 더 일찍 잘림
        score -= 30
        issues.append(f"{n}자: 40자 초과 (모바일 검색 결과에서 잘림)")
    elif n > 32:
        score -= 5
        issues.append(f"{n}자: 32자 초과 (일부 화면에서 잘릴 수 있음)")
    if n < 12:
        score -= 45
        issues.append(f"{n}자: 너무 짧아 검색 의도가 드러나지 않음")
    return {"title": title, "score": max(0, min(100, score)), "issues": issues}


def rank_titles(cands: list) -> list:
    seen, uniq = set(), []
    for t in cands:
        t = re.sub(r"\s+", " ", t.replace("\n", " ")).strip()
        if t and t not in seen:
            seen.add(t)
            uniq.append(t)
    scored = [score_title(t) for t in uniq]
    # 점수 동률이면 Claude 가 먼저 제시한 순서 유지
    return sorted(scored, key=lambda x: -x["score"])


# ---------------------------------------------------------------- 본문 검사
KO_INTENSIFIER = re.compile(r"(?<![가-힣])(진짜|완전(?![히한하])|대박|미쳤|레전드|엄청)")  # 완전히·완전한 은 정상 표현
KO_TRANSLATED = [
    "에 대해 알아보겠습니다", "에 대해 알아볼게요", "알아보도록 하겠습니다", "살펴보겠습니다",
    "살펴보도록 하겠습니다", "이것이 바로", "당신이 몰랐던", "당신은", "당신의",
]
PLACEHOLDER = re.compile(r"\[(사진|이미지|그림|image|photo)\s*[:：]", re.I)
END_HAMNIDA = re.compile(r"(니다|니까|십시오)[.!?]")
END_HAEYO = re.compile(r"(?<!니)[요죠][.!?]")


def _prose(md: str) -> str:
    md = CODE_BLOCK.sub(" ", md)
    lines = [l for l in md.splitlines() if not l.lstrip().startswith("|")]  # 표 제외
    return "\n".join(lines)


def _sentences(text: str) -> list:
    text = re.sub(r"^[#>\-\*\d\.\s]+", "", text, flags=re.M)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if len(s.strip()) > 5]


def check_body(md: str) -> list:
    """문제 목록: [{'level': 'fix'|'warn', 'msg': ...}]  fix 는 자동 수정 요청 대상"""
    out = []
    prose = _prose(md)

    hits = sorted({m.group(1) for m in KO_INTENSIFIER.finditer(prose)})
    if hits:
        out.append({"level": "fix", "msg": f"내용 없는 강조어 사용: {', '.join(hits)}"})
    tr = [p for p in KO_TRANSLATED if p in prose]
    if tr:
        out.append({"level": "fix", "msg": f"번역투 표현: {', '.join(tr)}"})
    if PLACEHOLDER.search(md):
        out.append({"level": "fix", "msg": "사진 자리표시([사진: ...])가 본문에 남아 있음"})

    a, b = len(END_HAMNIDA.findall(prose)), len(END_HAEYO.findall(prose))
    total = a + b
    if total >= 10 and min(a, b) / total > 0.15:
        out.append({"level": "fix", "msg": f"어미 혼용: 합니다체 {a}문장 / 해요체 {b}문장 → 한 가지로 통일 필요"})

    sents = _sentences(prose)
    if len(sents) >= 15:
        lens = [len(s) for s in sents]
        cv = statistics.pstdev(lens) / max(1, statistics.mean(lens))
        if cv < 0.3:
            out.append({"level": "warn", "msg": f"문장 길이가 단조로움 (변동계수 {cv:.2f}) → 기계적으로 읽힐 수 있음"})

    paras = [p for p in re.split(r"\n\s*\n", prose) if len(p.strip()) > 80]
    closers = [p.strip().splitlines()[-1] for p in paras]
    summary_like = sum(1 for c in closers if re.match(r"^(즉|결국|따라서|이처럼|이렇듯|결론적으로)", c))
    if len(paras) >= 6 and summary_like / len(paras) > 0.4:
        out.append({"level": "warn", "msg": "문단 대부분이 요약 문장(즉/결국/따라서…)으로 끝남"})

    if not re.search(r"^##\s", md, re.M):
        out.append({"level": "fix", "msg": "## 소제목 없음"})
    return out


# ---------------------------------------------------------------- 발행 이력 (훅 패턴·키워드 중복 방지)
def load_history(n: int = 20) -> list:
    if not HISTORY.exists():
        return []
    rows = []
    for line in HISTORY.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows[-n:]


def append_history(row: dict):
    with HISTORY.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
