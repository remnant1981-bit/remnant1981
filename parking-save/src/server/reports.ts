// 정보 오류 신고 저장·검토(자동 반영 없음)
import type { Db } from "./db";
import { audit, hashClient } from "./admin";

export const REPORT_CATEGORIES = { FEE: "요금이 달라요", HOURS: "운영시간이 달라요", LOCATION: "위치·주소가 달라요", CLOSED: "폐쇄됐어요/공사 중", OTHER: "기타" } as const;
export type ReportCategory = keyof typeof REPORT_CATEGORIES;
export const MAX_REPORT_MESSAGE = 500;

export type ReportInput = { ok: true; category: ReportCategory; message: string | null } | { ok: false; code: string; message: string };

/** 요청 본문 검증: 분류는 목록 중 하나, 내용은 선택(제어문자 제거, 최대 500자) */
export function parseReport(body: unknown): ReportInput {
  const b = (body ?? {}) as { category?: unknown; message?: unknown };
  if (typeof b.category !== "string" || !(b.category in REPORT_CATEGORIES)) return { ok: false, code: "INVALID_CATEGORY", message: "신고 유형을 선택하세요." };
  let msg: string | null = null;
  if (b.message != null) {
    if (typeof b.message !== "string") return { ok: false, code: "INVALID_MESSAGE", message: "내용 형식이 올바르지 않습니다." };
    msg = b.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (msg.length > MAX_REPORT_MESSAGE) return { ok: false, code: "MESSAGE_TOO_LONG", message: `내용은 ${MAX_REPORT_MESSAGE}자 이내로 적어 주세요.` };
    if (msg === "") msg = null;
  }
  return { ok: true, category: b.category as ReportCategory, message: msg };
}

export async function saveReport(db: Db, lotId: number, r: { category: ReportCategory; message: string | null }, clientKey: string, now = new Date()) {
  // 같은 클라이언트가 같은 시설·같은 유형을 24시간 안에 다시 신고하면 새로 쌓지 않음(중복 접수로 응답)
  const ch = hashClient(clientKey);
  const dup = await db.get("SELECT 1 AS x FROM lot_reports WHERE parking_lot_id=? AND category=? AND client_hash=? AND created_at >= ? LIMIT 1",
    [lotId, r.category, ch, new Date(now.getTime() - 86400_000).toISOString()]);
  if (dup) return { duplicate: true };
  await db.run("INSERT INTO lot_reports(parking_lot_id, category, message, created_at, client_hash) VALUES (?,?,?,?,?)", [lotId, r.category, r.message, now.toISOString(), ch]);
  return { duplicate: false };
}

export async function listReports(db: Db, status: "NEW" | "REVIEWED" | "DISMISSED" = "NEW", limit = 100) {
  return db.all<{ id: number; parking_lot_id: number; name: string; category: ReportCategory; message: string | null; created_at: string }>(
    `SELECT r.id, r.parking_lot_id, l.name, r.category, r.message, r.created_at FROM lot_reports r JOIN parking_lots l ON l.id = r.parking_lot_id
     WHERE r.status = ? ORDER BY r.created_at DESC LIMIT ?`, [status, limit]);
}

export async function decideReport(db: Db, id: number, status: "REVIEWED" | "DISMISSED", by: string, now = new Date(), clientKey?: string) {
  const r = await db.run("UPDATE lot_reports SET status=?, reviewed_by=?, reviewed_at=? WHERE id=? AND status='NEW'", [status, by.slice(0, 60), now.toISOString(), id]);
  await audit(db, `report:${status === "REVIEWED" ? "review" : "dismiss"}`, r.changes ? "OK" : "REJECTED", clientKey ?? `cli:${by.slice(0, 60)}`, `report ${id}`);
  return r.changes === 1;
}
