import { CATEGORIES, STATUS_LABEL } from "@/domain/taxonomy";
import type { SearchParams } from "@/domain/search";

export function conditionLines(p: SearchParams): string[] {
  const l: string[] = [];
  l.push(`검색어: ${p.q || "(없음)"}`);
  l.push(`분야: ${p.category.length ? p.category.map((c) => CATEGORIES.find((x) => x.id === c)?.name ?? c).join(", ") : "전체"}`);
  l.push(`지역: ${p.region || "전국/전체"}`);
  if (p.org) l.push(`지원기관: ${p.org}`);
  l.push(`접수 상태: ${p.status.length ? p.status.map((s) => STATUS_LABEL[s]).join(", ") : "전체"}`);
  if (p.from || p.to) l.push(`접수 기간: ${p.from || "~"} ~ ${p.to || "~"}`);
  if (p.soon) l.push("마감 임박(7일 이내)만");
  l.push(`정렬: ${p.sort}`);
  return l;
}
