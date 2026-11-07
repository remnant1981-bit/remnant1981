import ExcelJS from "exceljs";
import { HEADERS, type ExportRecord } from "./records";
import { safeCell } from "./csv";
import { formatSeoul } from "@/lib/time";

const WIDTH: Partial<Record<keyof ExportRecord, number>> = {
  category: 16, title: 44, organization: 22, region: 14, target: 30, support: 28, start: 12, end: 12, status: 16, fit: 16, checks: 36, url: 40, lastChecked: 18, sourceNote: 16,
};

export async function buildXlsx(records: ExportRecord[], withMatch: boolean, conditionLines: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GovBiz Finder";
  wb.created = new Date();
  const keys = (Object.keys(HEADERS) as (keyof ExportRecord)[]).filter((k) => withMatch || (k !== "fit" && k !== "checks"));
  const ws = wb.addWorksheet("공고 목록", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = keys.map((k) => ({ header: HEADERS[k], key: k, width: WIDTH[k] ?? 16 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
  for (const r of records) {
    const row: Record<string, string | Date> = {};
    for (const k of keys) {
      if ((k === "start" || k === "end") && /^\d{4}-\d{2}-\d{2}$/.test(r[k])) row[k] = new Date(r[k] + "T00:00:00Z");
      else row[k] = safeCell(r[k]); // 수식 주입 방지
    }
    ws.addRow(row);
  }
  for (const k of ["start", "end"] as const) {
    const idx = keys.indexOf(k);
    if (idx >= 0) ws.getColumn(idx + 1).numFmt = "yyyy-mm-dd";
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  ws.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: "top", wrapText: true }; });

  const info = wb.addWorksheet("조회 조건");
  info.getColumn(1).width = 90;
  info.addRow([safeCell("내보내기 시각: " + formatSeoul(new Date().toISOString()))]);
  for (const l of conditionLines) info.addRow([safeCell(l)]);
  info.addRow([""]);
  info.addRow(["※ 참고용 정보입니다. 최종 신청 자격과 접수 상태는 공식 원문 및 담당기관 확인이 기준입니다."]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
