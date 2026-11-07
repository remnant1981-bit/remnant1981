import { evaluateMatch, type CompanyProfile, type MatchResult, type Rule } from "@/domain/matching";
import { searchAllForExport, searchAnnouncements, type AnnouncementRow, type SearchParams } from "@/domain/search";
import { seoulToday } from "@/lib/time";
import { newId } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import type { Db } from "./db";

export async function loadRules(db: Db, ids: string[]): Promise<Map<string, Rule[]>> {
  const map = new Map<string, Rule[]>();
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await db.all<Rule & { announcement_id: string }>(
      `SELECT announcement_id, field_key, operator, expected_value, source_excerpt, confidence FROM eligibility_rules WHERE announcement_id IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const r of rows) (map.get(r.announcement_id) ?? map.set(r.announcement_id, []).get(r.announcement_id)!).push(r);
  }
  return map;
}

export function isLocal(row: AnnouncementRow, c: CompanyProfile): boolean {
  if (!c.region_sido || row.region_scope === "전국") return false;
  return row.region_scope === c.region_sido || row.region_scope.startsWith(c.region_sido + " ");
}

export type RowWithMatch = AnnouncementRow & { match: MatchResult | null; local: boolean };

const RANK = { likely_met: 0, needs_check: 1, likely_not_met: 2 } as const;

export async function attachMatches(db: Db, rows: AnnouncementRow[], company: CompanyProfile | null, today = seoulToday()): Promise<RowWithMatch[]> {
  if (!company) return rows.map((r) => ({ ...r, match: null, local: false }));
  const rules = await loadRules(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, match: evaluateMatch(rules.get(r.id) ?? [], company, today), local: isLocal(r, company) }));
}

/** 검색 + (기업정보가 있으면) 적합성 부착. sort=fit 이면 상위 500건을 평가해 정렬. */
export async function searchWithMatches(db: Db, p: SearchParams, company: CompanyProfile | null, today = seoulToday()) {
  if (company && p.sort === "fit") {
    const all = await attachMatches(db, await searchAllForExport(db, p, 500, today), company, today);
    all.sort((a, b) =>
      RANK[a.match!.overall] - RANK[b.match!.overall] || Number(b.local) - Number(a.local) || (b.match!.score ?? 0) - (a.match!.score ?? 0));
    const start = (p.page - 1) * p.pageSize;
    return { total: all.length, rows: all.slice(start, start + p.pageSize), page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(all.length / p.pageSize)) };
  }
  const r = await searchAnnouncements(db, p, today);
  return { ...r, rows: await attachMatches(db, r.rows, company, today) };
}

/** 추천 이력(company_matches) 저장 — 인증된 기업 컨텍스트에서만 호출. */
export async function saveMatches(db: Db, companyId: string, rows: RowWithMatch[]) {
  for (const r of rows) {
    if (!r.match) continue;
    await db.run(
      `INSERT INTO company_matches(id, company_id, announcement_id, result_status, score, reasons_json, evaluated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(company_id, announcement_id) DO UPDATE SET result_status=excluded.result_status, score=excluded.score, reasons_json=excluded.reasons_json, evaluated_at=excluded.evaluated_at`,
      [newId(), companyId, r.id, r.match.overall, r.match.score, JSON.stringify(r.match.results), nowIso()]);
  }
}
