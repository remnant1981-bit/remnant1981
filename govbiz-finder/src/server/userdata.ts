import { newId } from "@/lib/crypto";
import { nowIso, seoulToday, daysBetween } from "@/lib/time";
import { ApiError } from "./auth";
import type { Db } from "./db";
import { requireCompanyAccess } from "./company";
import { evaluateMatch, type CompanyProfile } from "@/domain/matching";
import { loadRules, isLocal } from "./recommend";
import type { AnnouncementRow } from "@/domain/search";

const ID = /^[0-9a-f]{32}$/;
async function annExists(db: Db, id: unknown): Promise<string> {
  if (typeof id !== "string" || !ID.test(id) || !(await db.get("SELECT 1 AS x FROM announcements WHERE id=? AND is_active=1", [id]))) {
    throw new ApiError(404, "not_found", "찾을 수 없습니다.");
  }
  return id;
}

// ---------- 관심 공고 ----------
export async function toggleBookmark(db: Db, userId: string, announcementId: unknown, on: boolean) {
  const cid = await requireCompanyAccess(db, userId, null);
  const aid = await annExists(db, announcementId);
  if (on) await db.run("INSERT OR IGNORE INTO bookmarks(user_id, company_id, announcement_id, created_at) VALUES (?,?,?,?)", [userId, cid, aid, nowIso()]);
  else await db.run("DELETE FROM bookmarks WHERE user_id=? AND company_id=? AND announcement_id=?", [userId, cid, aid]);
  return { bookmarked: on };
}
export async function listBookmarks(db: Db, userId: string) {
  const cid = await requireCompanyAccess(db, userId, null);
  return db.all(
    `SELECT a.id, a.title, a.organization, a.application_end, a.application_status, b.created_at FROM bookmarks b
     JOIN announcements a ON a.id=b.announcement_id WHERE b.user_id=? AND b.company_id=? ORDER BY b.created_at DESC LIMIT 200`, [userId, cid]);
}
export async function bookmarkedIds(db: Db, userId: string, companyId: string): Promise<Set<string>> {
  return new Set((await db.all<{ announcement_id: string }>("SELECT announcement_id FROM bookmarks WHERE user_id=? AND company_id=?", [userId, companyId])).map((r) => r.announcement_id));
}

// ---------- 이력 ----------
export async function recordSearch(db: Db, userId: string, companyId: string, query: unknown) {
  const q = JSON.stringify(query);
  if (q.length > 2000 || q === "{}") return;
  await db.run("INSERT INTO search_history(id,user_id,company_id,query_json,created_at) VALUES (?,?,?,?,?)", [newId(), userId, companyId, q, nowIso()]);
  await db.run(`DELETE FROM search_history WHERE user_id=? AND company_id=? AND id NOT IN (SELECT id FROM search_history WHERE user_id=? AND company_id=? ORDER BY created_at DESC LIMIT 100)`, [userId, companyId, userId, companyId]);
}
export async function recordView(db: Db, userId: string, companyId: string, announcementId: string) {
  await db.run("INSERT INTO view_history(id,user_id,company_id,announcement_id,viewed_at) VALUES (?,?,?,?,?)", [newId(), userId, companyId, announcementId, nowIso()]);
}
export async function listHistory(db: Db, userId: string) {
  const cid = await requireCompanyAccess(db, userId, null);
  const searches = await db.all<{ id: string; query_json: string; created_at: string }>(
    "SELECT id, query_json, created_at FROM search_history WHERE user_id=? AND company_id=? ORDER BY created_at DESC LIMIT 50", [userId, cid]);
  const views = await db.all(
    `SELECT v.id, v.viewed_at, a.id AS announcement_id, a.title FROM view_history v JOIN announcements a ON a.id=v.announcement_id
     WHERE v.user_id=? AND v.company_id=? ORDER BY v.viewed_at DESC LIMIT 50`, [userId, cid]);
  return { searches, views };
}
export async function clearHistory(db: Db, userId: string) {
  const cid = await requireCompanyAccess(db, userId, null);
  await db.run("DELETE FROM search_history WHERE user_id=? AND company_id=?", [userId, cid]);
  await db.run("DELETE FROM view_history WHERE user_id=? AND company_id=?", [userId, cid]);
}

// ---------- 알림 ----------
export const NOTIF_TYPES = ["new_announcement", "deadline_soon", "bookmark_changed"] as const;
export type NotifType = (typeof NOTIF_TYPES)[number];

export async function getNotificationSettings(db: Db, userId: string) {
  const cid = await requireCompanyAccess(db, userId, null);
  const rows = await db.all<{ type: NotifType; enabled: number; channel: string; deadline_days: number }>(
    "SELECT type, enabled, channel, deadline_days FROM notification_settings WHERE user_id=? AND company_id=?", [userId, cid]);
  return NOTIF_TYPES.map((t) => {
    const r = rows.find((x) => x.type === t);
    return { type: t, enabled: !!r?.enabled, channel: r?.channel ?? "in_app", deadlineDays: r?.deadline_days ?? 3 };
  });
}
export async function setNotificationSetting(db: Db, userId: string, input: { type?: unknown; enabled?: unknown; channel?: unknown; deadlineDays?: unknown }) {
  const cid = await requireCompanyAccess(db, userId, null);
  if (!NOTIF_TYPES.includes(input.type as NotifType)) throw new ApiError(400, "invalid_input", "알림 유형이 올바르지 않습니다.");
  const channel = input.channel === "email" ? "email" : "in_app";
  if (channel === "email" && !process.env.EMAIL_PROVIDER) throw new ApiError(400, "email_not_configured", "이메일 발송은 공급자 설정 후 사용할 수 있습니다. 현재는 앱 내 알림만 지원합니다.");
  const days = Math.max(1, Math.min(30, Number(input.deadlineDays ?? 3) || 3));
  await db.run(
    `INSERT INTO notification_settings(user_id,company_id,type,enabled,channel,deadline_days) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id,company_id,type) DO UPDATE SET enabled=excluded.enabled, channel=excluded.channel, deadline_days=excluded.deadline_days`,
    [userId, cid, input.type as string, input.enabled ? 1 : 0, channel, days]);
}
export async function listNotifications(db: Db, userId: string) {
  const cid = await requireCompanyAccess(db, userId, null);
  const rows = await db.all<{ id: string; type: string; payload_json: string; status: string; scheduled_at: string }>(
    "SELECT id, type, payload_json, status, scheduled_at FROM notifications WHERE user_id=? AND company_id=? ORDER BY scheduled_at DESC LIMIT 100", [userId, cid]);
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) as Record<string, unknown>, payload_json: undefined }));
}
export async function markNotificationsRead(db: Db, userId: string) {
  const cid = await requireCompanyAccess(db, userId, null);
  await db.run("UPDATE notifications SET status='read' WHERE user_id=? AND company_id=? AND status='unread'", [userId, cid]);
}

/** 배치(스케줄러/수집 후)에서 호출. 동일 공고 반복 알림은 dedupe_key 로 방지. 앱 내 알림만 생성. */
export async function generateNotifications(db: Db, today = seoulToday()): Promise<number> {
  const settings = await db.all<{ user_id: string; company_id: string; type: NotifType; deadline_days: number }>(
    `SELECT s.user_id, s.company_id, s.type, s.deadline_days FROM notification_settings s
     JOIN company_members m ON m.user_id=s.user_id AND m.company_id=s.company_id AND m.verification_status='verified'
     WHERE s.enabled=1 AND s.channel='in_app'`);
  let created = 0;
  const insert = async (userId: string, companyId: string, type: string, key: string, payload: object) => {
    const r = await db.run(
      "INSERT OR IGNORE INTO notifications(id,user_id,company_id,type,dedupe_key,payload_json,channel,status,scheduled_at) VALUES (?,?,?,?,?,?, 'in_app','unread',?)",
      [newId(), userId, companyId, type, key, JSON.stringify(payload), nowIso()]);
    created += r.changes;
  };
  for (const s of settings) {
    if (s.type === "new_announcement") {
      const company = await db.get<CompanyProfile>("SELECT region_sido, region_sigungu, industry_name, established_at, revenue_band, employee_count_band, research_institute_status, venture_status, export_status, tech_keywords, business_status FROM companies WHERE id=?", [s.company_id]);
      if (!company) continue;
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const rows = await db.all<AnnouncementRow>("SELECT a.id, a.title, a.region_scope, a.application_status FROM announcements a WHERE a.is_active=1 AND a.first_collected_at>=? AND a.application_status IN ('open','upcoming','always')" as string, [since]);
      const rules = await loadRules(db, rows.map((r) => r.id));
      for (const a of rows) {
        const m = evaluateMatch(rules.get(a.id) ?? [], company, today);
        if (m.overall === "likely_not_met") continue;
        if (a.region_scope !== "전국" && !isLocal(a, company)) continue; // 다른 지역 공고는 제외
        await insert(s.user_id, s.company_id, "new_announcement", `new:${a.id}`, { announcementId: a.id, title: a.title });
      }
    } else if (s.type === "deadline_soon") {
      // 관심 공고 + 우리 기업이 조건을 모두 충족한 공고의 마감 임박을 알린다(몰라서 놓치지 않도록)
      const marked = await db.all<{ id: string; title: string; application_end: string }>(
        `SELECT a.id, a.title, a.application_end FROM bookmarks b JOIN announcements a ON a.id=b.announcement_id
         WHERE b.user_id=? AND b.company_id=? AND a.is_active=1 AND a.application_status='open' AND a.application_end IS NOT NULL`, [s.user_id, s.company_id]);
      const company = await db.get<CompanyProfile>("SELECT * FROM companies WHERE id=?", [s.company_id]);
      const open = await db.all<{ id: string; title: string; application_end: string }>(
        "SELECT id, title, application_end FROM announcements WHERE is_active=1 AND application_status='open' AND application_end IS NOT NULL AND application_end >= ?", [today]);
      const near = open.filter((a) => { const d = daysBetween(today, a.application_end); return d >= 0 && d <= s.deadline_days; });
      const nearRules = await loadRules(db, near.map((a) => a.id));
      const metNear = company ? near.filter((a) => evaluateMatch(nearRules.get(a.id) ?? [], company, today).overall === "likely_met") : [];
      const rows = [...new Map([...marked, ...metNear].map((a) => [a.id, a])).values()];
      for (const a of rows) {
        const d = daysBetween(today, a.application_end);
        if (d >= 0 && d <= s.deadline_days) await insert(s.user_id, s.company_id, "deadline_soon", `deadline:${a.id}:${a.application_end}`, { announcementId: a.id, title: a.title, dDay: d });
      }
    } else if (s.type === "bookmark_changed") {
      const rows = await db.all<{ id: string; title: string; new_content_hash: string }>(
        `SELECT a.id, a.title, r.new_content_hash FROM bookmarks b JOIN announcements a ON a.id=b.announcement_id
         JOIN announcement_revisions r ON r.announcement_id=a.id AND r.changed_at>b.created_at WHERE b.user_id=? AND b.company_id=?`, [s.user_id, s.company_id]);
      for (const a of rows) await insert(s.user_id, s.company_id, "bookmark_changed", `changed:${a.id}:${a.new_content_hash}`, { announcementId: a.id, title: a.title });
    }
  }
  return created;
}
