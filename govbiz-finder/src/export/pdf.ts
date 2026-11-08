import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs";
import path from "node:path";
import { formatSeoul } from "@/lib/time";
import type { ExportRecord } from "./records";
import type { CompanyView } from "@/server/company";
import type { RowWithMatch } from "@/server/recommend";
import { DISPLAY_LABEL, STATE_LABEL } from "@/domain/matching";
import { categoryName } from "@/domain/taxonomy";

// 폰트는 의존성(@expo-google-fonts/noto-sans-kr, OFL)에서 런타임에 읽는다(번들러 추적 제외).
// 다른 위치를 쓰려면 PDF_FONT_DIR 지정. (Cloudflare Workers 에서는 파일시스템이 없으므로 R2/에셋 로딩으로 교체 필요)
function fontBytes(weight: "400Regular" | "700Bold"): Uint8Array {
  const base = process.env.PDF_FONT_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "@expo-google-fonts", "noto-sans-kr");
  return fs.readFileSync(path.join(base, weight, `NotoSansKR_${weight}.ttf`));
}

const PAGE = { w: 595.28, h: 841.89, m: 42 };

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private reg: PDFFont, private bold: PDFFont) { this.newPage(); }
  newPage() { this.page = this.doc.addPage([PAGE.w, PAGE.h]); this.y = PAGE.h - PAGE.m; }
  private wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const ch of para) {
        const t = line + ch;
        if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = ch; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, o: { size?: number; bold?: boolean; indent?: number; color?: [number, number, number]; gap?: number } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.bold : this.reg;
    const lines = this.wrap(text, font, size, PAGE.w - PAGE.m * 2 - (o.indent ?? 0));
    for (const l of lines) {
      if (this.y < PAGE.m + size) this.newPage();
      this.page.drawText(l, { x: PAGE.m + (o.indent ?? 0), y: this.y - size, size, font, color: rgb(...(o.color ?? [0.1, 0.1, 0.1])) });
      this.y -= size * 1.5;
    }
    this.y -= o.gap ?? 0;
  }
  rule() {
    if (this.y < PAGE.m + 10) this.newPage();
    this.page.drawLine({ start: { x: PAGE.m, y: this.y }, end: { x: PAGE.w - PAGE.m, y: this.y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    this.y -= 8;
  }
}

export interface PdfInput {
  records: ExportRecord[];
  rows: RowWithMatch[];
  company: CompanyView | null;
  conditionLines: string[];
  truncated: boolean;
}

export async function buildPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("GovBiz Finder 지원사업 검토 보고서");
  doc.setCreator("GovBiz Finder");
  const reg = await doc.embedFont(fontBytes("400Regular"), { subset: true });
  const bold = await doc.embedFont(fontBytes("700Bold"), { subset: true });
  const w = new Writer(doc, reg, bold);

  w.text("지원사업 검토 보고서", { size: 18, bold: true, gap: 4 });
  w.text(`작성일: ${formatSeoul(new Date().toISOString())} (Asia/Seoul)`);
  w.text("데이터 기준: 각 공고의 '최종 확인' 시각을 따름. 참고용 자료이며 최종 신청 자격·접수 상태는 공식 원문과 담당기관 확인이 기준입니다.", { color: [0.35, 0.35, 0.35], gap: 6 });
  w.rule();

  w.text("1. 기업 기본정보", { bold: true, size: 12, gap: 2 });
  if (input.company) {
    const c = input.company;
    const items: [string, string | null | undefined][] = [
      ["기업명", c.company_name], ["사업자등록번호", c.business_number_masked], ["대표자명", c.representative_name],
      ["소재지", [c.region_sido, c.region_sigungu].filter(Boolean).join(" ") || null], ["업종", c.industry_name], ["설립일", c.established_at],
      ["매출 규모", c.revenue_band], ["종업원 수", c.employee_count_band],
    ];
    const filled = items.filter(([, v]) => v);
    if (filled.length) for (const [k, v] of filled) w.text(`${k}: ${v}`, { indent: 8 });
    else w.text("등록된 기업정보가 없습니다. (미입력 항목은 '확인 필요'로 처리됨)", { indent: 8 });
  } else w.text("기업정보 없음(비회원 또는 미등록) — 기업 적합성 분석은 포함되지 않습니다.", { indent: 8 });
  w.y -= 4;

  w.text("2. 검색 조건", { bold: true, size: 12, gap: 2 });
  for (const l of input.conditionLines) w.text(l, { indent: 8 });
  w.y -= 4;

  w.text("3. 분야별 결과 요약", { bold: true, size: 12, gap: 2 });
  const counts = new Map<string, number>();
  for (const r of input.rows) for (const id of (r.category_ids ?? r.category ?? "").split(",").filter(Boolean)) counts.set(categoryName(id), (counts.get(categoryName(id)) ?? 0) + 1);
  w.text(`총 ${input.records.length}건${input.truncated ? " (상한 초과로 일부만 표시)" : ""}`, { indent: 8 });
  for (const [k, v] of counts) w.text(`${k}: ${v}건`, { indent: 8 });
  w.y -= 4;

  w.text("4. 검토 공고 목록", { bold: true, size: 12, gap: 2 });
  input.rows.forEach((r, i) => {
    const rec = input.records[i];
    w.rule();
    w.text(`${i + 1}. ${rec.title}`, { bold: true, size: 10.5 });
    w.text(`지원기관: ${rec.organization} / 지역: ${rec.region} / 분야: ${rec.category}`, { indent: 8 });
    w.text(`지원 대상: ${rec.target}`, { indent: 8 });
    w.text(`지원내용: ${rec.support}`, { indent: 8 });
    w.text(`접수: ${rec.start || "?"} ~ ${rec.end || "?"} / 상태: ${rec.status}`, { indent: 8 });
    w.text(`신청 방법: ${r.application_method ?? "원문 확인 필요"}`, { indent: 8 });
    if (r.match) {
      w.text(`기업 적합성(참고): ${DISPLAY_LABEL[r.match.display]}`, { indent: 8, bold: true });
      for (const x of r.match.results) w.text(`- [${STATE_LABEL[x.state]}] ${x.label}: ${x.reason}${x.excerpt ? ` (근거: "${x.excerpt}")` : ""}`, { indent: 16, size: 8.5 });
    }
    w.text(`공식 원문: ${rec.url}`, { indent: 8, size: 8.5, color: [0.1, 0.25, 0.6] });
    w.text(`출처: ${rec.sourceNote} / 최종 확인: ${rec.lastChecked}`, { indent: 8, size: 8.5, color: [0.4, 0.4, 0.4] });
  });
  w.y -= 6;
  w.rule();
  w.text("한계 안내: 본 보고서는 수집된 공개 공고와 입력된 기업정보만으로 규칙 기반으로 생성한 참고 자료입니다. 미입력 항목은 '확인 필요'이며 자격 판정이 아닙니다. 수집되지 않은 기관의 공고는 포함되지 않을 수 있습니다.", { size: 8.5, color: [0.35, 0.35, 0.35] });
  return doc.save();
}
