import type { Db, SqlValue } from "@/server/db";
import { CATEGORY_IDS, APP_STATUSES } from "./taxonomy";
import { isDeadlineSoon } from "./status";
import { seoulToday, isValidYmd } from "@/lib/time";

export const SORTS = ["relevance", "latest", "deadline", "start", "fit"] as const;
export type Sort = (typeof SORTS)[number];

export interface SearchParams {
  q: string;
  category: string[];
  region: string;       // '' = 전국/전체, 시도 or '시도 시군구'
  org: string;
  status: string[];
  from: string;         // 접수기간 필터(겹침)
  to: string;
  soon: boolean;        // 마감 임박(7일)
  eligible: boolean;    // 기업정보가 있을 때 미충족 가능성 높은 공고 제외
  sort: Sort;
  page: number;
  pageSize: number;
}

const arr = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);

/** URL query → 검증된 검색 조건. 알 수 없는 값은 버린다. */
export function parseSearchParams(sp: Record<string, string | string[] | undefined>): SearchParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) ?? "";
  const sort = (SORTS as readonly string[]).includes(one("sort")) ? (one("sort") as Sort) : "latest";
  const page = Math.max(1, Math.min(1000, parseInt(one("page") || "1", 10) || 1));
  const pageSize = Math.max(1, Math.min(50, parseInt(one("size") || "20", 10) || 20));
  return {
    q: one("q").slice(0, 100).trim(),
    category: arr(sp.category).filter((c) => CATEGORY_IDS.includes(c)),
    region: one("region").slice(0, 60).trim(),
    org: one("org").slice(0, 100).trim(),
    status: arr(sp.status).filter((s) => APP_STATUSES.includes(s)),
    from: isValidYmd(one("from")) ? one("from") : "",
    to: isValidYmd(one("to")) ? one("to") : "",
    soon: one("soon") === "1",
    eligible: one("eligible") === "1",
    sort,
    page,
    pageSize,
  };
}

export function toQueryString(p: Partial<SearchParams>): string {
  const u = new URLSearchParams();
  if (p.q) u.set("q", p.q);
  if (p.category?.length) u.set("category", p.category.join(","));
  if (p.region) u.set("region", p.region);
  if (p.org) u.set("org", p.org);
  if (p.status?.length) u.set("status", p.status.join(","));
  if (p.from) u.set("from", p.from);
  if (p.to) u.set("to", p.to);
  if (p.soon) u.set("soon", "1");
  if (p.eligible) u.set("eligible", "1");
  if (p.sort && p.sort !== "latest") u.set("sort", p.sort);
  if (p.page && p.page > 1) u.set("page", String(p.page));
  return u.toString();
}

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

export interface AnnouncementRow {
  id: string; title: string; organization: string; category: string | null; region_scope: string;
  target_summary: string | null; support_summary: string | null; support_amount_text: string | null;
  support_amount_min: number | null; support_amount_max: number | null; application_method: string | null;
  application_start: string | null; application_end: string | null; application_status: string; status_basis: string;
  canonical_url: string; source_id: string; source_name: string; source_status: string;
  first_collected_at: string; last_checked_at: string; published_at: string | null; category_ids: string | null;
}

const SELECT = `SELECT a.id, a.title, a.organization, a.category, a.region_scope, a.target_summary, a.support_summary,
  a.support_amount_text, a.support_amount_min, a.support_amount_max, a.application_method, a.application_start, a.application_end,
  a.application_status, a.status_basis, a.canonical_url, a.source_id, s.name AS source_name, s.integration_status AS source_status,
  a.first_collected_at, a.last_checked_at, a.published_at,
  (SELECT group_concat(category_id) FROM announcement_categories ac WHERE ac.announcement_id=a.id) AS category_ids
  FROM announcements a JOIN data_sources s ON s.id=a.source_id`;

/** 지역 필터: 선택 지역 공고 + 전국 공고(전국 누락 금지). 시군구 선택 시 해당 시도 전체 공고도 포함. */
function regionClause(region: string, params: SqlValue[]): string {
  if (!region) return "";
  const [sido] = region.split(" ");
  params.push(region, sido, sido + " %");
  return " AND (a.region_scope='전국' OR a.region_scope=? OR a.region_scope=? OR a.region_scope LIKE ?)";
}

export function buildWhere(p: SearchParams, today: string): { where: string; params: SqlValue[] } {
  const params: SqlValue[] = [];
  let where = " WHERE a.is_active=1";
  if (p.q) {
    // 공백으로 분리한 모든 토큰이 어느 필드엔가 포함(AND)
    for (const tok of p.q.split(/\s+/).slice(0, 6)) {
      const l = "%" + likeEsc(tok) + "%";
      where += ` AND (a.title LIKE ? ESCAPE '\\' OR a.organization LIKE ? ESCAPE '\\' OR a.target_summary LIKE ? ESCAPE '\\'
        OR a.support_summary LIKE ? ESCAPE '\\' OR a.eligibility_text LIKE ? ESCAPE '\\' OR a.original_text LIKE ? ESCAPE '\\')`;
      params.push(l, l, l, l, l, l);
    }
  }
  if (p.category.length) {
    where += ` AND EXISTS (SELECT 1 FROM announcement_categories ac WHERE ac.announcement_id=a.id AND ac.category_id IN (${p.category.map(() => "?").join(",")}))`;
    params.push(...p.category);
  }
  where += regionClause(p.region, params);
  if (p.org) {
    where += " AND a.organization LIKE ? ESCAPE '\\'";
    params.push("%" + likeEsc(p.org) + "%");
  }
  if (p.status.length) {
    where += ` AND a.application_status IN (${p.status.map(() => "?").join(",")})`;
    params.push(...p.status);
  }
  if (p.from) { where += " AND (a.application_end IS NULL OR a.application_end >= ?)"; params.push(p.from); }
  if (p.to) { where += " AND (a.application_start IS NULL OR a.application_start <= ?)"; params.push(p.to); }
  if (p.soon) {
    const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7);
    where += " AND a.application_status='open' AND a.application_end IS NOT NULL AND a.application_end >= ? AND a.application_end <= ?";
    params.push(today, d.toISOString().slice(0, 10));
  }
  return { where, params };
}

function orderBy(sort: Sort, q: string, params: SqlValue[]): string {
  switch (sort) {
    case "deadline":
      return " ORDER BY (a.application_status='open') DESC, (a.application_end IS NULL), a.application_end ASC, a.title ASC";
    case "start":
      return " ORDER BY (a.application_start IS NULL), a.application_start DESC, a.title ASC";
    case "relevance":
      if (q) {
        params.push("%" + likeEsc(q) + "%", "%" + likeEsc(q) + "%");
        return " ORDER BY (CASE WHEN a.title LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END + CASE WHEN a.organization LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) DESC, a.first_collected_at DESC";
      }
      return " ORDER BY a.first_collected_at DESC, a.title ASC";
    default:
      return " ORDER BY COALESCE(a.published_at, a.first_collected_at) DESC, a.title ASC";
  }
}

export async function searchAnnouncements(db: Db, p: SearchParams, today = seoulToday()) {
  const { where, params } = buildWhere(p, today);
  const total = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM announcements a${where}`, params))?.n ?? 0;
  const op: SqlValue[] = [...params];
  // 'fit' 정렬은 기업 적합도(서비스 계층에서 후처리), DB 단에서는 최신순
  const ob = orderBy(p.sort === "fit" ? "latest" : p.sort, p.q, op);
  const rows = await db.all<AnnouncementRow>(`${SELECT}${where}${ob} LIMIT ? OFFSET ?`, [...op, p.pageSize, (p.page - 1) * p.pageSize]);
  return { total, rows, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** 내보내기용: 페이지네이션 없이 현재 필터 전체(상한 적용). */
export async function searchAllForExport(db: Db, p: SearchParams, limit = 2000, today = seoulToday()) {
  const { where, params } = buildWhere(p, today);
  const op: SqlValue[] = [...params];
  const ob = orderBy(p.sort === "fit" ? "latest" : p.sort, p.q, op);
  return db.all<AnnouncementRow>(`${SELECT}${where}${ob} LIMIT ?`, [...op, limit]);
}

export async function getAnnouncement(db: Db, id: string) {
  if (!/^[0-9a-f]{32}$/.test(id)) return undefined;
  return db.get<AnnouncementRow & Record<string, string | number | null>>(`${SELECT.replace("a.published_at,", "a.published_at, a.eligibility_text, a.required_documents, a.contact_info, a.original_text,")} WHERE a.id=? AND a.is_active=1`, [id]);
}

export async function getAnnouncementExtras(db: Db, id: string) {
  const [files, sources, rules] = await Promise.all([
    db.all<{ name: string; source_url: string; mime_type: string | null; size_bytes: number | null }>(
      "SELECT name, source_url, mime_type, size_bytes FROM announcement_files WHERE announcement_id=?", [id]),
    db.all<{ source_id: string; name: string; url: string; first_seen_at: string }>(
      "SELECT x.source_id, s.name, x.url, x.first_seen_at FROM announcement_sources x JOIN data_sources s ON s.id=x.source_id WHERE x.announcement_id=?", [id]),
    db.all<{ field_key: string; operator: string; expected_value: string; source_excerpt: string | null; confidence: number }>(
      "SELECT field_key, operator, expected_value, source_excerpt, confidence FROM eligibility_rules WHERE announcement_id=?", [id]),
  ]);
  return { files, sources, rules };
}

export async function listFacets(db: Db) {
  const orgs = await db.all<{ organization: string }>("SELECT DISTINCT organization FROM announcements WHERE is_active=1 ORDER BY organization LIMIT 200");
  return { organizations: orgs.map((o) => o.organization) };
}

export { isDeadlineSoon };
