import tempfile
import unittest
from pathlib import Path

import ops_status as o

H = "| 번호 | 일자 | 프로젝트 | 대표 지시 | 담당 팀장 | 산출물 경로 | 검수 | 상태 | 비고 |\n|---|---|---|---|---|---|---|---|---|\n"
SAMPLE = (
    "# 제목\n\n## 양식\n\n| 번호 | 상태 |\n|---|---|\n| X-1 | 가짜 |\n\n## 기록\n\n" + H +
    "| W-3 | d | P3 | 지시 | a | `x` | 미완료 | 진행 | |\n"
    "| W-2 | d | P2 | 지시 \\| 파이프 | b | `y` | 해당없음(내부용) | 완료 | 비고 a\\|b |\n"
    "| W-1 | d | P1 | 지시 | c | `z` |  | 보류 | |\n"
    "| W-0 | d | P0 | 지시 | c | `z` | 조이 검토 | 완료 | |\n"
    "\n## 다음\n| 번호 | 상태 |\n|---|---|\n| Z | 접수 |\n"
)


class T(unittest.TestCase):
    def test_split_escaped_pipe(self):
        self.assertEqual(o.split_row("| a \\| b | c | |"), ["a | b", "c", ""])

    def test_parse_only_record_section(self):
        recs = o.parse_records(SAMPLE)
        self.assertEqual([r["번호"] for r in recs], ["W-3", "W-2", "W-1", "W-0"])
        self.assertEqual(recs[1]["대표 지시"], "지시 | 파이프")
        self.assertEqual(recs[1]["비고"], "비고 a|b")

    def test_empty_cells_kept(self):
        recs = o.parse_records(SAMPLE)
        self.assertEqual(recs[2]["검수"], "")

    def test_bad_row_warns(self):
        w = []
        recs = o.parse_records(SAMPLE.replace("| W-3 |", "| W-3 | 여분 | 여분 |"), w)
        self.assertEqual(len(recs), 3)
        self.assertEqual(len(w), 1)

    def test_summary(self):
        out = o.summarize(o.parse_records(SAMPLE))
        self.assertIn("| 완료 | 2 |", out)
        self.assertIn("| 진행 | 1 |", out)
        self.assertIn("| 보류 | 1 |", out)
        self.assertIn("미완료 항목 (상태 != 완료): 2건", out)
        self.assertIn("검수 미완료 건 (검수 = 미완료 또는 빈 값): 2건", out)
        self.assertIn("(빈 값)", out)
        self.assertIn("비표준 값): 1건", out)

    def test_escape_on_output(self):
        recs = [{"번호": "W-1", "프로젝트": "a|b", "담당 팀장": "", "검수": "미완료", "상태": "진행", "비고": ""}]
        self.assertIn("a\\|b", o.summarize(recs))

    def test_no_section(self):
        with self.assertRaises(ValueError):
            o.parse_records("# x\n| a |\n")

    def test_missing_column(self):
        with self.assertRaises(ValueError):
            o.parse_records("## 기록\n\n| 번호 | 상태 |\n|---|---|\n| W | 완료 |\n")

    def test_empty_table(self):
        out = o.summarize(o.parse_records("## 기록\n\n" + H))
        self.assertIn("전체 0건", out)
        self.assertIn("해당 없음", out)

    def test_cli_output_and_readonly(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d) / "log.md", Path(d) / "sub" / "out.md"
            src.write_text(SAMPLE, encoding="utf-8")
            self.assertEqual(o.main(["-i", str(src)]), 0)
            self.assertFalse(dst.exists())  # 기본은 파일 미생성
            self.assertEqual(o.main(["-i", str(src), "-o", str(dst)]), 0)
            self.assertIn("상태별 건수", dst.read_text(encoding="utf-8"))
            self.assertEqual(src.read_text(encoding="utf-8"), SAMPLE)
            self.assertEqual(o.main(["-i", str(src), "-o", str(src)]), 2)
            self.assertEqual(src.read_text(encoding="utf-8"), SAMPLE)

    def test_missing_file(self):
        self.assertEqual(o.main(["-i", "/nonexistent/x.md"]), 2)


if __name__ == "__main__":
    unittest.main()
