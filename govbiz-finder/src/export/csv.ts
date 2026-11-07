import { HEADERS, type ExportRecord } from "./records";

/** CSV/수식 주입 방지: 수식 시작 문자(= + - @ 탭 CR)로 시작하는 값 앞에 ' 를 붙인다. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
function esc(v: string): string {
  const s = safeCell(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCsv(records: ExportRecord[], withMatch: boolean): string {
  const keys = (Object.keys(HEADERS) as (keyof ExportRecord)[]).filter((k) => withMatch || (k !== "fit" && k !== "checks"));
  const lines = [keys.map((k) => esc(HEADERS[k])).join(",")];
  for (const r of records) lines.push(keys.map((k) => esc(r[k])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // UTF-8 BOM(엑셀 호환)
}
