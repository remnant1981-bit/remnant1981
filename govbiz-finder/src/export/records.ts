import { categoryName, STATUS_LABEL } from "@/domain/taxonomy";
import { DISPLAY_LABEL, STATE_LABEL } from "@/domain/matching";
import type { RowWithMatch } from "@/server/recommend";
import { formatSeoul } from "@/lib/time";

export interface ExportRecord {
  category: string; title: string; organization: string; region: string; target: string; support: string;
  start: string; end: string; status: string; fit: string; checks: string; url: string; lastChecked: string; sourceNote: string;
}

function supportText(r: RowWithMatch): string {
  return r.support_amount_text || r.support_summary || "확인 필요";
}

export function toExportRecords(rows: RowWithMatch[], withMatch: boolean): ExportRecord[] {
  return rows.map((r) => {
    const m = withMatch ? r.match : null;
    const checks = m ? m.results.filter((x) => x.state !== "MET").map((x) => `${x.label}: ${STATE_LABEL[x.state]}`).join("; ") : "";
    const statusLabel = STATUS_LABEL[r.application_status] + (r.status_basis === "estimated" && r.application_status !== "unknown" ? "(날짜 기준 추정)" : "");
    return {
      category: (r.category_ids ? r.category_ids.split(",").map(categoryName).join(", ") : categoryName(r.category)),
      title: r.title,
      organization: r.organization,
      region: r.region_scope,
      target: r.target_summary || "확인 필요",
      support: supportText(r),
      start: r.application_start ?? "",
      end: r.application_end ?? "",
      status: statusLabel,
      fit: m ? DISPLAY_LABEL[m.display] : "",
      checks,
      url: r.canonical_url,
      lastChecked: formatSeoul(r.last_checked_at),
      sourceNote: r.source_status === "mock" ? "테스트 데이터" : r.source_name,
    };
  });
}

export const HEADERS: Record<keyof ExportRecord, string> = {
  category: "분야", title: "사업명", organization: "지원기관", region: "지역", target: "지원 대상", support: "지원금액/지원내용",
  start: "접수 시작일", end: "접수 마감일", status: "접수 상태", fit: "기업 적합성", checks: "확인 필요 항목", url: "공식 원문 링크",
  lastChecked: "최종 확인일", sourceNote: "출처",
};
