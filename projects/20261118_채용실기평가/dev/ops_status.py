#!/usr/bin/env python3
"""ops/work-log.md 의 '## 기록' 표를 읽어 업무 현황을 마크다운으로 요약한다.

- 표준 라이브러리만 사용 (Python 3.10+)
- 입력 파일은 읽기만 한다 (수정 없음)
- 기본은 stdout 출력, --output 지정 시 파일 저장
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

SECTION_HEADING = "기록"
STATUS_ORDER = ["접수", "진행", "검수중", "승인대기", "완료", "보류"]
DONE_STATUS = "완료"
REVIEW_PENDING = "미완료"
REVIEW_OK_VALUES = ("완료", "해당없음")  # 접두 일치 (예: 해당없음(내부용))
EMPTY_MARK = "(빈 값)"
DEFAULT_LOG = Path(__file__).resolve().parents[3] / "ops" / "work-log.md"


def split_row(line: str) -> list[str]:
    """표 한 행을 셀로 분리. `\\|` 는 셀 내용의 '|' 로 복원한다."""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells, buf, i = [], [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            buf.append("|")
            i += 2
            continue
        if s[i] == "|":
            cells.append("".join(buf).strip())
            buf = []
        else:
            buf.append(s[i])
        i += 1
    cells.append("".join(buf).strip())
    return cells


_SEP_RE = re.compile(r"^\s*:?-{1,}:?\s*$")


def _is_separator(cells: list[str]) -> bool:
    return bool(cells) and all(_SEP_RE.match(c) for c in cells)


def parse_records(text: str, warnings: list[str] | None = None) -> list[dict[str, str]]:
    """'## 기록' 섹션의 첫 표를 {헤더: 값} 목록으로 반환한다.

    섹션이 없으면 ValueError. 열 수가 헤더와 다른 행은 경고 후 건너뛴다.
    """
    warnings = warnings if warnings is not None else []
    lines = text.splitlines()
    start = None
    for idx, ln in enumerate(lines):
        if re.match(rf"^#{{2}}\s+{SECTION_HEADING}\s*$", ln.strip()):
            start = idx + 1
            break
    if start is None:
        raise ValueError(f"'## {SECTION_HEADING}' 섹션을 찾을 수 없음")

    header: list[str] | None = None
    records: list[dict[str, str]] = []
    for ln in lines[start:]:
        stripped = ln.strip()
        if re.match(r"^#{1,6}\s", stripped):  # 다음 섹션
            break
        if not stripped.startswith("|"):
            if header is not None and records:
                break  # 표 종료
            if header is not None and stripped == "":
                continue
            continue
        cells = split_row(stripped)
        if header is None:
            header = cells
            continue
        if _is_separator(cells):
            continue
        if len(cells) != len(header):
            warnings.append(f"열 수 불일치로 건너뜀({len(cells)}/{len(header)}): {stripped[:60]}")
            continue
        records.append(dict(zip(header, cells)))
    if header is None:
        raise ValueError(f"'## {SECTION_HEADING}' 섹션에 표가 없음")
    for col in ("번호", "상태", "검수"):
        if col not in header:
            raise ValueError(f"필수 열 없음: {col}")
    return records


def esc(value: str) -> str:
    """마크다운 표 셀 출력용 이스케이프."""
    return (value or "").replace("|", "\\|").replace("\n", " ")


def _table(headers: list[str], rows: list[list[str]]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows]
    return out


def _status(r: dict[str, str]) -> str:
    return r.get("상태", "").strip()


def _review(r: dict[str, str]) -> str:
    return r.get("검수", "").strip()


def review_is_pending(r: dict[str, str]) -> bool:
    v = _review(r)
    return v == REVIEW_PENDING or v == ""


def review_is_nonstandard(r: dict[str, str]) -> bool:
    v = _review(r)
    if v in ("", REVIEW_PENDING, "—", "-"):
        return False
    return not v.startswith(REVIEW_OK_VALUES)


def summarize(records: list[dict[str, str]]) -> str:
    counts = Counter(_status(r) or EMPTY_MARK for r in records)
    ordered = [s for s in STATUS_ORDER if s in counts]
    ordered += [s for s in counts if s not in STATUS_ORDER]  # 미정의 상태도 누락 없이
    out = ["# 업무 현황 요약", "", f"전체 {len(records)}건", "", "## 상태별 건수", ""]
    out += _table(["상태", "건수"], [[s, str(counts[s])] for s in ordered] or [["-", "0"]])

    incomplete = [r for r in records if _status(r) != DONE_STATUS]
    out += ["", f"## 미완료 항목 (상태 != {DONE_STATUS}): {len(incomplete)}건", ""]
    cols = ["번호", "프로젝트", "담당 팀장", "상태", "비고"]
    if incomplete:
        out += _table(cols, [[r.get(c, "") for c in cols] for r in incomplete])
    else:
        out.append("해당 없음")

    pend = [r for r in records if review_is_pending(r)]
    out += ["", f"## 검수 미완료 건 (검수 = {REVIEW_PENDING} 또는 빈 값): {len(pend)}건", ""]
    cols = ["번호", "프로젝트", "담당 팀장", "검수", "상태"]
    if pend:
        out += _table(cols, [[r.get(c, "") or EMPTY_MARK if c == "검수" else r.get(c, "") for c in cols] for r in pend])
    else:
        out.append("해당 없음")

    odd = [r for r in records if review_is_nonstandard(r)]
    if odd:
        out += ["", f"## 검수 값 확인 필요 (비표준 값): {len(odd)}건", ""]
        out += _table(cols, [[r.get(c, "") for c in cols] for r in odd])
    return "\n".join(out) + "\n"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="work-log.md '## 기록' 표 현황 요약 (읽기 전용)")
    p.add_argument("--input", "-i", type=Path, default=DEFAULT_LOG, help="work-log.md 경로 (기본: ops/work-log.md)")
    p.add_argument("--output", "-o", type=Path, default=None, help="지정 시 결과를 파일로도 저장 (기본: stdout만)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        text = args.input.read_text(encoding="utf-8")
    except OSError as e:
        print(f"오류: 입력 파일을 읽을 수 없음: {e}", file=sys.stderr)
        return 2
    warnings: list[str] = []
    try:
        records = parse_records(text, warnings)
    except ValueError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 1
    for w in warnings:
        print(f"경고: {w}", file=sys.stderr)
    report = summarize(records)
    sys.stdout.write(report)
    if args.output:
        try:
            if args.output.resolve() == args.input.resolve():
                print("오류: --output 이 입력 파일과 같음 (덮어쓰기 방지)", file=sys.stderr)
                return 2
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(report, encoding="utf-8")
        except OSError as e:
            print(f"오류: 파일 저장 실패: {e}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
