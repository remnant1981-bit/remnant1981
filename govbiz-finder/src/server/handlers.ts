import { route, json, readJson, type Ctx } from "./api";
import {
  ApiError, clearCookie, destroySession, login, register, sessionCookie,
} from "./auth";
import {
  applyNtsStatus, deleteCompanyData, getCompanyProfile, membershipState, ntsStatusLookup, requestCompanyClaim, saveCompanyProfile,
  validateProfile, approveClaim, rejectClaim, requireCompanyAccess,
} from "./company";
import { getAnnouncement, getAnnouncementExtras, listFacets, parseSearchParams, searchAllForExport, toQueryString } from "@/domain/search";
import { evaluateMatch } from "@/domain/matching";
import { attachMatches, loadRules, saveMatches, searchWithMatches } from "./recommend";
import {
  bookmarkedIds, clearHistory, getNotificationSettings, listBookmarks, listHistory, listNotifications, markNotificationsRead,
  recordSearch, recordView, setNotificationSetting, toggleBookmark,
} from "./userdata";
import { adminCreateAnnouncement, adminSetActive, adminUpdateAnnouncement, audit, listClaims, listDuplicates } from "./admin";
import { buildCsv } from "@/export/csv";
import { buildXlsx } from "@/export/xlsx";
import { buildPdf } from "@/export/pdf";
import { toExportRecords } from "@/export/records";
import { conditionLines } from "@/export";
import { runSource } from "@/collector/runner";
import { getAdapter } from "@/collector/registry";
import { seoulToday } from "@/lib/time";
import { redactString } from "@/lib/log";

type RouteCtx = { params: Promise<{ id?: string; format?: string }> };
const searchOf = (req: Request) => parseSearchParams(Object.fromEntries(new URL(req.url).searchParams.entries()));

async function viewerCompany(c: Ctx) {
  if (!c.session) return { companyId: null as string | null, profile: null };
  const st = await membershipState(c.db, c.session.user.id);
  if (st.status !== "verified" || !st.companyId) return { companyId: null, profile: null };
  return { companyId: st.companyId, profile: await getCompanyProfile(c.db, c.session.user.id, st.companyId) };
}

export const handlers: Record<string, (req: Request, ...a: any[]) => Promise<Response>> = {
  // ---------- 인증 ----------
  "GET /api/auth/me": route({ auth: "none" }, async (_req, c) => {
    if (!c.session) return { user: null };
    return { user: { email: c.session.user.email, role: c.session.user.role }, csrf: c.session.csrf, company: await membershipState(c.db, c.session.user.id) };
  }),
  "POST /api/auth/register": route({ auth: "none" }, async (req, c) => {
    const b = await readJson<{ email?: string; password?: string }>(req);
    const r = await register(c.db, String(b.email ?? ""), String(b.password ?? ""), c.ip);
    // 중복 이메일이어도 동일한 응답 형태(계정 존재 여부 비노출)
    return json({ ok: true, next: "login_or_continue" }, r.created ? { cookie: sessionCookie(r.session.token, r.session.maxAge) } : {});
  }),
  "POST /api/auth/login": route({ auth: "none" }, async (req, c) => {
    const b = await readJson<{ email?: string; password?: string }>(req);
    const r = await login(c.db, String(b.email ?? ""), String(b.password ?? ""), c.ip);
    return json({ ok: true }, { cookie: sessionCookie(r.session.token, r.session.maxAge) });
  }),
  "POST /api/auth/logout": route({ auth: "none" }, async (req, c) => {
    await destroySession(c.db, req.headers.get("cookie"));
    return json({ ok: true }, { cookie: clearCookie() });
  }),

  // ---------- 공개 검색/상세 ----------
  "GET /api/announcements": route({ auth: "none" }, async (req, c) => {
    const p = searchOf(req);
    const v = await viewerCompany(c);
    const result = await searchWithMatches(c.db, p, v.profile);
    if (v.companyId && c.session) await recordSearch(c.db, c.session.user.id, v.companyId, JSON.parse(JSON.stringify({ ...p, page: undefined, pageSize: undefined })));
    const marks = v.companyId && c.session ? await bookmarkedIds(c.db, c.session.user.id, v.companyId) : new Set<string>();
    return { ...result, rows: result.rows.map((r) => ({ ...r, bookmarked: marks.has(r.id) })), query: toQueryString(p), hasCompany: !!v.companyId };
  }),
  "GET /api/announcements/:id": route({ auth: "none" }, async (_req, c, rc: RouteCtx) => {
    const { id } = await rc.params;
    const a = await getAnnouncement(c.db, id ?? "");
    if (!a) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
    const extras = await getAnnouncementExtras(c.db, a.id);
    const v = await viewerCompany(c);
    let match = null;
    let bookmarked = false;
    if (v.companyId && c.session) {
      const rules = await loadRules(c.db, [a.id]);
      match = evaluateMatch(rules.get(a.id) ?? [], v.profile, seoulToday());
      await recordView(c.db, c.session.user.id, v.companyId, a.id);
      bookmarked = (await bookmarkedIds(c.db, c.session.user.id, v.companyId)).has(a.id);
    }
    return { announcement: a, ...extras, match, bookmarked };
  }),
  "GET /api/facets": route({ auth: "none" }, async (_req, c) => listFacets(c.db)),

  // ---------- 기업정보(비회원 stateless / 회원) ----------
  "POST /api/nts/status": route({ auth: "none" }, async (req, c) => {
    const b = await readJson<{ bizNo?: unknown }>(req);
    const st = await ntsStatusLookup(c.db, b.bizNo, c.ip);
    return { status: st, notice: st.isMock ? "테스트 데이터입니다. 실제 국세청 조회 결과가 아닙니다." : null };
  }),
  // 비회원: 입력값은 저장·로깅하지 않고 요청 내에서만 평가
  "POST /api/match/preview": route({ auth: "none" }, async (req, c) => {
    const b = await readJson<{ profile?: Record<string, unknown>; query?: Record<string, string> }>(req);
    await (await import("./auth")).rateLimit(c.db, `preview:${c.ip}`, 60, 600);
    const profile = validateProfile(b.profile ?? {});
    const p = parseSearchParams({ ...(b.query ?? {}), sort: "fit", size: "50" });
    const company = { ...profile, business_status: null };
    const all = await searchWithMatches(c.db, p, company);
    const result = await searchWithMatches(c.db, { ...p, eligible: true }, company); // 미충족 가능성 높음 제외
    return { ...result, excluded: all.total - result.total, stored: false };
  }),
  "POST /api/company/claim": route({ auth: "user" }, async (req, c) => {
    const b = await readJson<{ bizNo?: unknown }>(req);
    return requestCompanyClaim(c.db, c.session!.user.id, b.bizNo); // 존재 여부와 무관하게 동일 응답 형태
  }),
  "GET /api/company": route({ auth: "user" }, async (_req, c) => {
    const st = await membershipState(c.db, c.session!.user.id);
    if (st.status !== "verified") return { membership: st.status, company: null };
    return { membership: "verified", company: await getCompanyProfile(c.db, c.session!.user.id, st.companyId) };
  }),
  "PUT /api/company": route({ auth: "user" }, async (req, c) => {
    const b = await readJson(req);
    return { company: await saveCompanyProfile(c.db, c.session!.user.id, b) };
  }),
  "DELETE /api/company": route({ auth: "user" }, async (_req, c) => {
    await deleteCompanyData(c.db, c.session!.user.id);
    return { ok: true };
  }),
  "POST /api/company/nts": route({ auth: "user" }, async (req, c) => {
    const b = await readJson<{ bizNo?: unknown }>(req);
    const st = await applyNtsStatus(c.db, c.session!.user.id, b.bizNo, c.ip);
    return { status: st, notice: st.isMock ? "테스트 데이터입니다. 실제 국세청 조회 결과가 아닙니다." : null };
  }),
  "GET /api/recommendations": route({ auth: "user" }, async (req, c) => {
    const cid = await requireCompanyAccess(c.db, c.session!.user.id, null);
    const profile = await getCompanyProfile(c.db, c.session!.user.id, cid);
    const p = searchOf(req);
    p.sort = "fit";
    const result = await searchWithMatches(c.db, p, profile);
    await saveMatches(c.db, cid, result.rows);
    return result;
  }),

  // ---------- 내보내기 ----------
  "GET /api/export/:format": route({ auth: "none" }, async (req, c, rc: RouteCtx) => {
    const { format } = await rc.params;
    if (format !== "csv" && format !== "xlsx" && format !== "pdf") throw new ApiError(404, "not_found", "찾을 수 없습니다.");
    const p = searchOf(req);
    const v = await viewerCompany(c); // 기업별 정보는 인증된 해당 기업 사용자에게만 포함
    const limit = 2000;
    let rows;
    if (v.profile && (p.sort === "fit" || p.eligible)) rows = (await searchWithMatches(c.db, { ...p, page: 1, pageSize: 500 }, v.profile)).rows;
    else rows = await attachMatches(c.db, await searchAllForExport(c.db, p, limit), v.profile);
    const withMatch = !!v.profile;
    const records = toExportRecords(rows, withMatch);
    const stamp = seoulToday().replace(/-/g, "");
    const dl = (body: BodyInit, type: string, ext: string) =>
      new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="govbiz-${stamp}.${ext}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (format === "csv") return dl(buildCsv(records, withMatch), "text/csv; charset=utf-8", "csv");
    if (format === "xlsx") return dl(new Uint8Array(await buildXlsx(records, withMatch, conditionLines(p))), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
    return dl(new Uint8Array(await buildPdf({ records, rows, company: v.profile, conditionLines: conditionLines(p), truncated: rows.length >= limit })), "application/pdf", "pdf");
  }),

  // ---------- 관심/이력/알림 ----------
  "GET /api/bookmarks": route({ auth: "user" }, async (_req, c) => ({ items: await listBookmarks(c.db, c.session!.user.id) })),
  "POST /api/bookmarks": route({ auth: "user" }, async (req, c) => {
    const b = await readJson<{ announcementId?: unknown }>(req);
    return toggleBookmark(c.db, c.session!.user.id, b.announcementId, true);
  }),
  "DELETE /api/bookmarks": route({ auth: "user" }, async (req, c) => {
    const b = await readJson<{ announcementId?: unknown }>(req);
    return toggleBookmark(c.db, c.session!.user.id, b.announcementId, false);
  }),
  "GET /api/history": route({ auth: "user" }, async (_req, c) => listHistory(c.db, c.session!.user.id)),
  "DELETE /api/history": route({ auth: "user" }, async (_req, c) => {
    await clearHistory(c.db, c.session!.user.id);
    return { ok: true };
  }),
  "GET /api/notifications": route({ auth: "user" }, async (_req, c) => ({ items: await listNotifications(c.db, c.session!.user.id) })),
  "POST /api/notifications/read": route({ auth: "user" }, async (_req, c) => {
    await markNotificationsRead(c.db, c.session!.user.id);
    return { ok: true };
  }),
  "GET /api/notifications/settings": route({ auth: "user" }, async (_req, c) => ({ settings: await getNotificationSettings(c.db, c.session!.user.id), emailAvailable: !!process.env.EMAIL_PROVIDER })),
  "PUT /api/notifications/settings": route({ auth: "user" }, async (req, c) => {
    await setNotificationSetting(c.db, c.session!.user.id, await readJson(req));
    return { settings: await getNotificationSettings(c.db, c.session!.user.id) };
  }),

  // ---------- 관리자 ----------
  "GET /api/admin/overview": route({ auth: "admin" }, async (_req, c) => {
    const sources = await c.db.all("SELECT id,name,source_type,enabled,integration_status,collection_frequency,quota_note,last_success_at,last_error,next_run_at FROM data_sources ORDER BY name");
    const runs = await c.db.all("SELECT id,source_id,started_at,finished_at,status,fetched_count,inserted_count,updated_count,skipped_count,error_summary FROM collection_runs ORDER BY started_at DESC LIMIT 30");
    return { sources, runs };
  }),
  "POST /api/admin/collect": route({ auth: "admin" }, async (req, c) => {
    const b = await readJson<{ sourceId?: string }>(req);
    const adapter = getAdapter(String(b.sourceId));
    if (!adapter) throw new ApiError(400, "not_integrated", "해당 원천은 연동되지 않았거나 인증키가 설정되지 않았습니다.");
    const r = await runSource(c.db, adapter);
    await audit(c.db, c.session!.user.id, "collect.run", "data_source", String(b.sourceId), { status: r.status });
    return r;
  }),
  "PUT /api/admin/sources/:id": route({ auth: "admin" }, async (req, c, rc: { params: Promise<{ id?: string }> }) => {
    const { id } = await rc.params;
    const b = await readJson<{ enabled?: unknown }>(req);
    const src = await c.db.get<{ integration_status: string }>("SELECT integration_status FROM data_sources WHERE id=?", [id ?? ""]);
    if (!src) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
    if (b.enabled && src.integration_status === "not_integrated") throw new ApiError(400, "not_integrated", "미연동 원천은 활성화할 수 없습니다.");
    await c.db.run("UPDATE data_sources SET enabled=? WHERE id=?", [b.enabled ? 1 : 0, id!]);
    await audit(c.db, c.session!.user.id, "source.toggle", "data_source", id!, { enabled: !!b.enabled });
    return { ok: true };
  }),
  "GET /api/admin/announcements": route({ auth: "admin" }, async (_req, c) => ({
    items: await c.db.all("SELECT id,title,organization,application_status,is_active,source_id,updated_at FROM announcements ORDER BY updated_at DESC LIMIT 200"),
  })),
  "POST /api/admin/announcements": route({ auth: "admin" }, async (req, c) => adminCreateAnnouncement(c.db, c.session!.user.id, await readJson(req, 200_000))),
  "PUT /api/admin/announcements/:id": route({ auth: "admin" }, async (req, c, rc: RouteCtx) => {
    const { id } = await rc.params;
    const b = await readJson<Record<string, unknown>>(req, 200_000);
    if (typeof b.isActive === "boolean" && Object.keys(b).length === 1) {
      await adminSetActive(c.db, c.session!.user.id, id ?? "", b.isActive);
      return { ok: true };
    }
    return adminUpdateAnnouncement(c.db, c.session!.user.id, id ?? "", b);
  }),
  "GET /api/admin/claims": route({ auth: "admin" }, async (_req, c) => ({ items: await listClaims(c.db) })),
  "POST /api/admin/claims": route({ auth: "admin" }, async (req, c) => {
    const b = await readJson<{ userId?: string; companyId?: string; decision?: string }>(req);
    if (typeof b.userId !== "string" || typeof b.companyId !== "string") throw new ApiError(400, "invalid_input", "요청 형식이 올바르지 않습니다.");
    if (b.decision === "approve") await approveClaim(c.db, b.userId, b.companyId, "admin_review", c.session!.user.id);
    else if (b.decision === "reject") await rejectClaim(c.db, b.userId, b.companyId, c.session!.user.id);
    else throw new ApiError(400, "invalid_input", "요청 형식이 올바르지 않습니다.");
    await audit(c.db, c.session!.user.id, `claim.${b.decision}`, "company", b.companyId);
    return { ok: true };
  }),
  "GET /api/admin/duplicates": route({ auth: "admin" }, async (_req, c) => ({ items: await listDuplicates(c.db) })),
  "GET /api/admin/audit": route({ auth: "admin" }, async (_req, c) => ({
    items: await c.db.all("SELECT id,admin_user_id,action,target_type,target_id,created_at,metadata_redacted_json FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100"),
  })),
};

export { redactString };
