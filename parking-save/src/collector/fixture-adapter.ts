import fs from "node:fs";
import type { RawRow, SourceAdapter } from "./types";

/**
 * 픽스처 어댑터: JSON 파일 행을 그대로 공급. 실제 원천 호출이 아님.
 * 표준데이터 컬럼 구조는 포털 공개 페이지의 샘플 행 형식을 따른다(실호출 규격 미검증).
 */
export class FixtureAdapter implements SourceAdapter {
  constructor(readonly sourceName: string, private readonly file: string) {}
  async *fetch(): AsyncIterable<RawRow> {
    const rows = JSON.parse(fs.readFileSync(this.file, "utf8")) as { rows: RawRow[] };
    for (const r of rows.rows) yield r;
  }
}
