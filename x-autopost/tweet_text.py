"""
트윗 본문 검사·보정 (외부 의존성 없음)

- X 글자 수 계산: twitter-text v3 기준 근사
  · 라틴·기본 문장부호 = 1, 한글·한자·이모지 등 = 2, URL = 23 (길이 무관), 최대 280
  · 이모지 결합 시퀀스는 실제보다 크게 셈 → 넘칠 일은 없음 (보수적)
- 광고 표시: 공정위 「추천·보증 등에 관한 표시·광고 심사지침」 → 경제적 이해관계는 게시물 첫 부분에 표시
  → 본문이 표시 문구로 시작하지 않으면 맨 앞에 붙임
"""

import re

MAX_WEIGHT = 280
URL_WEIGHT = 23
URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)

# twitter-text v3: 가중치 1 범위 (그 외 2)
_LIGHT_RANGES = ((0, 4351), (8192, 8205), (8208, 8223), (8242, 8247))

# 과장·단정 표현 (광고 심사·스팸 판정 위험) → 발견 시 경고/재작성
BANNED_WORDS = ("무조건", "100%", "평생", "공짜로 돈", "누구나 수익", "확정 수익", "최저가 보장", "선착순 마감 임박")


def _char_weight(ch: str) -> int:
    cp = ord(ch)
    for lo, hi in _LIGHT_RANGES:
        if lo <= cp <= hi:
            return 1
    return 2


def weighted_length(text: str) -> int:
    total, pos = 0, 0
    for m in URL_RE.finditer(text):
        total += sum(_char_weight(c) for c in text[pos:m.start()]) + URL_WEIGHT
        pos = m.end()
    total += sum(_char_weight(c) for c in text[pos:])
    return total


def ensure_disclosure(text: str, disclosure: str = "[광고]") -> str:
    """본문 첫머리에 광고 표시가 없으면 붙임 (#광고·[광고]·(광고)·광고) 로 시작하면 그대로)"""
    head = text.lstrip()
    for mark in (disclosure, "[광고]", "#광고", "(광고)", "[AD]", "#AD"):
        if mark and head.upper().startswith(mark.upper()):
            return head
    return f"{disclosure} {head}" if disclosure else head


def compose(body: str, url: str, disclosure: str = "[광고]") -> str:
    """광고 표시 + 본문 + 링크(본문에 없을 때만 끝에 붙임)"""
    text = ensure_disclosure(body.strip(), disclosure)
    if url and url not in text:
        text = f"{text}\n{url}"
    return text


def check(text: str, url: str = "", disclosure: str = "[광고]") -> list[str]:
    """문제 목록 (빈 리스트 = 통과)"""
    problems = []
    n = weighted_length(text)
    if n > MAX_WEIGHT:
        problems.append(f"글자 수 초과 ({n}/{MAX_WEIGHT}, 한글은 1자=2)")
    if ensure_disclosure(text, disclosure) != text.lstrip():
        problems.append("첫머리 광고 표시 없음")
    if url and url not in text:
        problems.append("캠페인 링크 없음")
    if len(URL_RE.findall(text)) > 1:
        problems.append("링크 2개 이상 (스팸 판정 위험)")
    if len(re.findall(r"#\S+", text)) > 3:
        problems.append("해시태그 3개 초과")
    if re.search(r"\{[^}]*\}|○○|XXXX", text):
        problems.append("빈칸 미입력 ({…}/○○/XXXX 남아 있음)")
    for w in BANNED_WORDS:
        if w in text:
            problems.append(f"과장 표현: {w}")
    return problems
