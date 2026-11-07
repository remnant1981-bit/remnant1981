import { newId } from "@/lib/crypto";
import { nowIso } from "@/lib/time";
import { ApiError } from "./auth";
import type { Db } from "./db";
import { normalizeAnnouncement, upsertAnnouncement, ValidationError, type RawAnnouncement } from "@/domain/announcements";
import { redact } from "@/lib/log";

export async function audit(db: Db, adminId: string, action: string, targetType: string | null, targetId: string | null, meta?: unknown) {
  await db.run("INSERT INTO admin_audit_logs(id,admin_user_id,action,target_type,target_id,created_at,metadata_redacted_json) VALUES (?,?,?,?,?,?,?)",
    [newId(), adminId, action, targetType, targetId, nowIso(), meta === undefined ? null : JSON.stringify(redact(meta))]);
}

const S = (v: unknown, max = 20000) => (typeof v === "string" ? v.slice(0, max) : undefined);

export function toRaw(body: Record<string, unknown>, sourceNoticeId: string): RawAnnouncement {
  const cats = Array.isArray(body.categories) ? body.categories.filter((c): c is string => typeof c === "string") : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  return {
    sourceNoticeId,
    url: S(body.url, 2000) ?? "",
    title: S(body.title, 500) ?? "",
    organization: S(body.organization, 200) ?? "",
    categories: cats,
    regionScope: S(body.regionScope, 100),
    targetSummary: S(body.targetSummary),
    supportSummary: S(body.supportSummary),
    supportAmountText: S(body.supportAmountText, 200),
    supportAmountMin: num(body.supportAmountMin),
    supportAmountMax: num(body.supportAmountMax),
    applicationStart: S(body.applicationStart, 10) || null,
    applicationEnd: S(body.applicationEnd, 10) || null,
    confirmedStatus: (["upcoming", "open", "closed", "always"] as const).find((s) => s === body.confirmedStatus) ?? null,
    eligibilityText: S(body.eligibilityText),
    requiredDocuments: S(body.requiredDocuments),
    applicationMethod: S(body.applicationMethod),
    contactInfo: S(body.contactInfo),
    originalText: S(body.originalText, 50000),
  };
}

export async function adminCreateAnnouncement(db: Db, adminId: string, body: Record<string, unknown>) {
  try {
    const n = await normalizeAnnouncement(toRaw(body, "manual-" + newId()));
    const r = await upsertAnnouncement(db, "manual", n, `admin:${adminId}`);
    await audit(db, adminId, "announcement.create", "announcement", r.id, { title: n.title });
    return r;
  } catch (e) {
    if (e instanceof ValidationError) throw new ApiError(400, "invalid_input", e.message);
    throw e;
  }
}

export async function adminUpdateAnnouncement(db: Db, adminId: string, id: string, body: Record<string, unknown>) {
  const cur = await db.get<{ source_id: string; source_notice_id: string }>("SELECT source_id, source_notice_id FROM announcements WHERE id=?", [id]);
  if (!cur) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  try {
    const n = await normalizeAnnouncement(toRaw(body, cur.source_notice_id));
    const r = await upsertAnnouncement(db, cur.source_id, n, `admin:${adminId}`);
    await audit(db, adminId, "announcement.update", "announcement", id, { title: n.title });
    return r;
  } catch (e) {
    if (e instanceof ValidationError) throw new ApiError(400, "invalid_input", e.message);
    throw e;
  }
}

export async function adminSetActive(db: Db, adminId: string, id: string, active: boolean) {
  const r = await db.run("UPDATE announcements SET is_active=?, updated_at=? WHERE id=?", [active ? 1 : 0, nowIso(), id]);
  if (!r.changes) throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  await db.run("INSERT INTO announcement_revisions(id,announcement_id,changed_at,changed_by,change_summary) VALUES (?,?,?,?,?)",
    [newId(), id, nowIso(), `admin:${adminId}`, active ? "활성화" : "비활성화"]);
  await audit(db, adminId, active ? "announcement.activate" : "announcement.deactivate", "announcement", id);
}

export async function listClaims(db: Db) {
  // 관리자 검토용: 마스킹된 번호만 노출. 동일 기업에 복수 신청이 있으면 conflict 표시
  return db.all(
    `SELECT m.company_id, m.user_id, u.email, c.business_number_masked, c.company_name, m.verification_status, m.created_at,
      (SELECT COUNT(*) FROM company_members x WHERE x.company_id=m.company_id) AS claim_count,
      (SELECT COUNT(*) FROM company_members x WHERE x.company_id=m.company_id AND x.verification_status='verified') AS verified_count
     FROM company_members m JOIN users u ON u.id=m.user_id JOIN companies c ON c.id=m.company_id
     ORDER BY (m.verification_status='pending') DESC, m.created_at DESC LIMIT 200`);
}

export async function listDuplicates(db: Db) {
  return db.all(
    `SELECT a.id, a.title, a.organization, COUNT(x.source_id || x.source_notice_id) AS source_count, group_concat(x.url, ' | ') AS urls
     FROM announcements a JOIN announcement_sources x ON x.announcement_id=a.id GROUP BY a.id HAVING source_count > 1 LIMIT 100`);
}
