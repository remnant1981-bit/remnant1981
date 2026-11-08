import { evaluateMatch, type CompanyProfile, type MatchResult, type Rule } from "@/domain/matching";
import { searchAllForExport, searchAnnouncements, type AnnouncementRow, type SearchParams } from "@/domain/search";
import { seoulToday } from "@/lib/time";
import { newId } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import type { Db } from "./db";
import { SIDO } from "@/domain/taxonomy";

/**
 * 공고의 지역 표기(구조화된 필드)로 지역 조건을 자동 생성한다.
 * - '경기도' → 시/도 조건, '경기도 시흥시' → 시/도 + 시/군/구(신뢰도 낮음: 입력 표기 차이가 있을 수 있어 불일치는 확인 필요)
 * - '경기도 외 N곳', '전남광주', 복수 지역 표기, '전국'은 판정할 수 없으므로 생성하지 않는다.
 */
export function regionRulesFor(scope: string): Rule[] {
  if (!scope || scope === "전국" || /\s외\s*\d+곳$/.test(scope)) return [];
  if (scope.includes("·")) {
    // 복수 지역: 모든 항목이 시/도일 때만 '이 중 하나'로 판정(전남광주 등 해석 불가 항목이 있으면 판정하지 않음)
    const parts = scope.split("·");
    if (!parts.every((x) => (SIDO as readonly string[]).includes(x))) return [];
    return [{ field_key: "region_sido", operator: "in", expected_value: JSON.stringify(parts), source_excerpt: `공고 지역: ${parts.join(", ")}`, confidence: 1 }];
  }
  const sido = SIDO.find((x) => scope === x || scope.startsWith(x + " "));
  if (!sido) return [];
  const rules: Rule[] = [{ field_key: "region_sido", operator: "in", expected_value: JSON.stringify([sido]), source_excerpt: `공고 지역: ${scope}`, confidence: 1 }];
  const rest = scope.slice(sido.length).trim();
  if (rest) rules.push({ field_key: "region_sigungu", operator: "in", expected_value: JSON.stringify([rest]), source_excerpt: `공고 지역: ${scope}`, confidence: 0.5 });
  return rules;
}

export async function loadRules(db: Db, ids: string[]): Promise<Map<string, Rule[]>> {
  const map = new Map<string, Rule[]>();
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const regions = await db.all<{ id: string; region_scope: string }>(
      `SELECT id, region_scope FROM announcements WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
    const rows = await db.all<Rule & { announcement_id: string }>(
      `SELECT announcement_id, field_key, operator, expected_value, source_excerpt, confidence FROM eligibility_rules WHERE announcement_id IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const r of rows) (map.get(r.announcement_id) ?? map.set(r.announcement_id, []).get(r.announcement_id)!).push(r);
    // 공고가 지역 조건을 직접 갖고 있지 않으면 지역 표기에서 자동 생성
    for (const g of regions) {
      const cur = map.get(g.id) ?? [];
      if (!cur.some((x) => x.field_key === "region_sido")) map.set(g.id, [...cur, ...regionRulesFor(g.region_scope)]);
    }
  }
  return map;
}

export function isLocal(row: AnnouncementRow, c: CompanyProfile): boolean {
  if (!c.region_sido || row.region_scope === "전국") return false;
  return row.region_scope.split("·").some((x) => x === c.region_sido || x.startsWith(c.region_sido + " "));
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
  if (company && (p.sort === "fit" || p.eligible)) {
    let all = await attachMatches(db, await searchAllForExport(db, p, 1000, today), company, today);
    if (p.eligible) all = all.filter((r) => r.match!.overall !== "likely_not_met"); // 미충족 가능성 높음 제외(확인 필요는 유지)
    if (p.sort === "fit") {
      all.sort((a, b) =>
        RANK[a.match!.overall] - RANK[b.match!.overall] || Number(b.local) - Number(a.local) || (b.match!.score ?? 0) - (a.match!.score ?? 0));
    }
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
