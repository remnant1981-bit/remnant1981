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

const SIZE_TOKENS: Record<string, string[]> = { 중소기업: ["중소기업", "소상공인"], 소상공인: ["소상공인"], 중견기업: ["중견기업"], 대기업: ["대기업"] };
const CERT_PATTERNS: [RegExp, string][] = [[/여성기업/, "여성기업"], [/장애인기업/, "장애인기업"], [/사회적기업/, "사회적기업"], [/뿌리기업/, "뿌리기업"], [/이노비즈/, "이노비즈"], [/메인비즈/, "메인비즈"]];

function excerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 20);
  return text.slice(start, Math.min(text.length, index + len + 30)).replace(/\s+/g, " ").trim();
}

/**
 * 공고의 구조화 필드·본문 문장에서 판정 규칙을 정규식으로 만든다(AI 미사용).
 * 본문 기반 규칙은 신뢰도를 낮게(0.5) 두어 '충족' 신호만 주고, 불일치는 미충족으로 단정하지 않는다(우대 조건 오인 방지).
 */
/** 시/군/구로 끝나지만 지명이 아닌 단어(오인 방지) */
const NOT_PLACE = new Set(["연구", "지구", "요구", "탐구", "도구", "기구", "출구", "입구", "가구", "완구", "전시", "도시", "동시", "수시", "상시", "즉시", "개시", "공시", "게시", "표시", "감시", "제시", "적시", "평시", "역군", "장군"]);

/**
 * 공고명 앞의 시/군/구 추출: '[경기] 안성시 2026년 …', '[경기] 수원시ㆍ용인시ㆍ화성시 …', '[인천] 서구 …'.
 * 기업마당은 시/군 공고에도 지역 태그를 도 단위로만 달기 때문에 공고명에서 보완한다.
 */
export function titleSigungu(title: string | null | undefined): string[] {
  const m = (title ?? "").match(/^\s*\[[^\]]+\]\s*([가-힣]{1,5}(?:시|군|구)(?:\s*[ㆍ·,]\s*[가-힣]{1,5}(?:시|군|구))*)(?=\s|\(|$)/);
  if (!m) return [];
  const names = m[1].split(/\s*[ㆍ·,]\s*/).map((x) => x.trim()).filter((x) => x.length >= 2 && !NOT_PLACE.has(x));
  return names.length === m[1].split(/\s*[ㆍ·,]\s*/).length ? names : []; // 하나라도 지명이 아니면 판정하지 않음
}

/** [업종 분야, 신뢰도]. 0.7 이상은 불일치 시 '해당 안 됨', 그 미만은 '확인 필요' */
const INDUSTRY_PATTERNS: [RegExp, string, number][] = [
  [/농가|농업인|농업경영체|농어업인|농산물|축산농가|축산물|어업인|어가|수산물|임업인|친환경농|귀농/, "농림축수산업", 0.7],
  [/관광사업체|관광기업|관광업체|숙박업|숙박시설|음식점|외식업/, "관광·숙박·음식점", 0.7],
  [/건설업체|건설기업|전문건설|건설사업자/, "건설업", 0.7],
  [/의료기관|약국|한의원/, "보건·의료", 0.6],
  [/콘텐츠\s*(?:기업|업체|사업자|제작사)|게임\s*(?:기업|업체|개발사)|출판사/, "콘텐츠·미디어", 0.5],
  [/(?:SW|소프트웨어|ICT)\s*(?:기업|업체)/i, "정보통신·SW", 0.5],
];
export function industryTargets(text: string): [string, number][] {
  if (/가공|제조|스마트팜\s*기업|유통업체/.test(text)) return [];
  const hit = INDUSTRY_PATTERNS.filter(([re]) => re.test(text));
  // 서로 다른 업종이 여러 개 걸리면 범용 공고일 수 있어 신뢰도를 낮춤
  return hit.map(([, g, c]) => [g, hit.length > 1 ? Math.min(c, 0.5) : c]);
}

export function textRulesFor(row: { title?: string | null; target_summary?: string | null; eligibility_text?: string | null; original_text?: string | null; region_scope?: string | null }): Rule[] {
  const rules: Rule[] = [];
  // 시/군/구 한정 공고(공고명 기준). 시/도 단위 공고에서만 적용, 기업 시/군/구가 다르면 '미충족 가능성 높음'
  const scope = row.region_scope ?? "";
  if (scope && scope !== "전국" && !scope.includes("·") && !scope.includes(" ")) {
    // '서울시'·'부산시'처럼 시/도 자체를 줄여 쓴 표기는 시/군/구가 아님
    const short = scope.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, "");
    const cities = titleSigungu(row.title).filter((c) => c !== `${short}시`);
    if (cities.length) rules.push({ field_key: "region_sigungu", operator: "in", expected_value: JSON.stringify(cities), source_excerpt: `공고명: ${(row.title ?? "").slice(0, 60)}`, confidence: 0.7 });
  }
  const body = [row.eligibility_text, row.original_text].filter(Boolean).join("\n");
  // 지원 대상 규모(기업마당 '지원대상' 필드). 본문에 중견기업이 함께 언급되면 포함
  const tokens = (row.target_summary ?? "").split(/[,/·ㆍ\s]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length && tokens.every((t) => SIZE_TOKENS[t])) {
    const allowed = new Set(tokens.flatMap((t) => SIZE_TOKENS[t]));
    if (/중견/.test(body)) allowed.add("중견기업");
    rules.push({ field_key: "enterprise_size", operator: "in", expected_value: JSON.stringify([...allowed]), source_excerpt: `지원 대상: ${row.target_summary}`, confidence: 0.5 });
  }
  // 업력/창업 N년 이내·이상
  const m = body.match(/(업력|창업(?:\s*후)?|설립(?:\s*후)?)\s*(\d{1,2})\s*년\s*(이내|미만|이하|이상|초과)/);
  if (m && m.index !== undefined) {
    const n = Number(m[2]);
    const op = m[3] === "이상" || m[3] === "초과" ? "gte" : "lte";
    rules.push({ field_key: "business_age_years", operator: op, expected_value: JSON.stringify(n), source_excerpt: excerptAround(body, m.index, m[0].length), confidence: 0.5 });
  }
  // 특정 인증 대상(제목·대상에 명시된 경우)
  const head = `${row.title ?? ""} ${row.target_summary ?? ""}`;
  // 업종 한정 공고(공고명·지원대상에 수혜 업종이 명시된 경우). 가공·제조를 함께 언급하면 제외(식품가공 등 혼재)
  const groups = industryTargets(head);
  if (groups.length) rules.push({ field_key: "industry_group", operator: "in", expected_value: JSON.stringify(groups.map((g) => g[0])), source_excerpt: `공고명/대상: ${head.trim().slice(0, 80)}`, confidence: Math.min(...groups.map((g) => g[1])) });
  const certs = CERT_PATTERNS.filter(([re]) => re.test(head)).map(([, c]) => c);
  if (certs.length) rules.push({ field_key: "certification", operator: "in", expected_value: JSON.stringify(certs), source_excerpt: `공고명/대상: ${head.trim().slice(0, 80)}`, confidence: 0.5 });
  return rules;
}

export async function loadRules(db: Db, ids: string[]): Promise<Map<string, Rule[]>> {
  const map = new Map<string, Rule[]>();
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const regions = await db.all<{ id: string; region_scope: string; title: string; target_summary: string | null; eligibility_text: string | null; original_text: string | null }>(
      `SELECT id, region_scope, title, target_summary, eligibility_text, original_text FROM announcements WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
    const rows = await db.all<Rule & { announcement_id: string }>(
      `SELECT announcement_id, field_key, operator, expected_value, source_excerpt, confidence FROM eligibility_rules WHERE announcement_id IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const r of rows) (map.get(r.announcement_id) ?? map.set(r.announcement_id, []).get(r.announcement_id)!).push(r);
    // 공고가 지역 조건을 직접 갖고 있지 않으면 지역 표기에서 자동 생성
    for (const g of regions) {
      const cur = map.get(g.id) ?? [];
      const extra = [...regionRulesFor(g.region_scope), ...textRulesFor(g)].filter((r) => !cur.some((x) => x.field_key === r.field_key));
      if (extra.length) map.set(g.id, [...cur, ...extra]);
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
  return rows.map((r) => ({ ...r, match: evaluateMatch(rules.get(r.id) ?? [], company, today, r.id), local: isLocal(r, company) }));
}

/** 적합성 평가 대상 상한. 전체 공고를 빠짐없이 평가하기 위해 충분히 크게 둔다(초과 시 truncated 표시). */
export const MATCH_CANDIDATE_LIMIT = 20000;

export interface MatchCounts { likely_met: number; needs_check: number; likely_not_met: number }
/** 미입력 기업정보 항목별로 판정을 막고 있는 공고 수(정확도 높이기 안내용) */
export interface MissingStat { fieldKey: string; label: string; count: number }

function missingStatsOf(rows: RowWithMatch[]): { missing: MissingStat[]; accuracy: number | null } {
  const m = new Map<string, MissingStat>();
  let sum = 0, n = 0;
  for (const r of rows) {
    if (!r.match || r.match.overall === "likely_not_met") continue;
    if (r.match.accuracy !== null) { sum += r.match.accuracy; n++; }
    const seen = new Set<string>();
    for (const x of r.match.results) {
      if (!x.missing || seen.has(x.fieldKey)) continue;
      seen.add(x.fieldKey);
      const cur = m.get(x.fieldKey) ?? { fieldKey: x.fieldKey, label: x.label, count: 0 };
      cur.count++; m.set(x.fieldKey, cur);
    }
  }
  return { missing: [...m.values()].sort((a, b) => b.count - a.count), accuracy: n ? Math.round(sum / n) : null };
}

function interestHit(row: AnnouncementRow, c: CompanyProfile): boolean {
  if (!c.interest_categories || !row.category_ids) return false;
  const want = c.interest_categories.split(",");
  return row.category_ids.split(",").some((x) => want.includes(x));
}

/** 검색 + (기업정보가 있으면) 적합성 부착. 적합도순/해당 가능 필터는 조건에 맞는 전체 공고를 평가한다. */
export async function searchWithMatches(db: Db, p: SearchParams, company: CompanyProfile | null, today = seoulToday()) {
  if (company && (p.sort === "fit" || p.eligible || p.metOnly)) {
    const candidates = await searchAllForExport(db, p, MATCH_CANDIDATE_LIMIT, today);
    let all = await attachMatches(db, candidates, company, today);
    const counts: MatchCounts = { likely_met: 0, needs_check: 0, likely_not_met: 0 };
    for (const r of all) counts[r.match!.overall]++;
    const stats = missingStatsOf(all);
    if (p.metOnly) all = all.filter((r) => r.match!.overall === "likely_met"); // 확인된 조건을 모두 충족한 공고만
    else if (p.eligible) all = all.filter((r) => r.match!.overall !== "likely_not_met"); // 미충족 가능성 높음 제외(확인 필요는 유지)
    if (p.sort === "fit") {
      all.sort((a, b) =>
        RANK[a.match!.overall] - RANK[b.match!.overall] || Number(b.local) - Number(a.local) ||
        Number(interestHit(b, company)) - Number(interestHit(a, company)) || (b.match!.score ?? 0) - (a.match!.score ?? 0));
    }
    const start = (p.page - 1) * p.pageSize;
    return {
      total: all.length, rows: all.slice(start, start + p.pageSize), page: p.page, pageSize: p.pageSize,
      pages: Math.max(1, Math.ceil(all.length / p.pageSize)), counts, truncated: candidates.length >= MATCH_CANDIDATE_LIMIT,
      missing: stats.missing, accuracy: stats.accuracy,
    };
  }
  const r = await searchAnnouncements(db, p, today);
  return { ...r, rows: await attachMatches(db, r.rows, company, today), counts: null as MatchCounts | null, truncated: false, missing: [] as MissingStat[], accuracy: null as number | null };
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
