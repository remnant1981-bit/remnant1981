// 관리자 수동 보정(요금·운영시간): 적용·수집 후 재적용·되돌리기·이력.
// 원칙: 보정은 관리자가 현장·공고로 확인한 값만 넣는다(추정 입력 금지 — 화면에 안내). 원천 값은 스냅샷으로 보존하고 언제든 되돌릴 수 있다.
import type { Db } from "./db";
import { audit } from "./admin";

export type OverrideKind = "FEE" | "HOURS";
export type FeePayload = { free: true } | { free: false; baseMinutes: number; baseAmount: number; addMinutes: number | null; addAmount: number | null; dailyMax: number | null };
export type HoursRow = { dayType: "WEEKDAY" | "SATURDAY" | "SUNDAY" | "HOLIDAY" | "EVERYDAY"; mode: "HOURS" | "ALL_DAY" | "CLOSED"; open: string | null; close: string | null };
export type HoursPayload = { rows: HoursRow[] };
export type ParsedOverride = { ok: true; kind: "FEE"; payload: FeePayload; note: string | null; reportId: number | null } | { ok: true; kind: "HOURS"; payload: HoursPayload; note: string | null; reportId: number | null } | { ok: false; code: string; message: string };

const bad = (code: string, message: string): ParsedOverride => ({ ok: false, code, message });
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DAYS = ["WEEKDAY", "SATURDAY", "SUNDAY", "HOLIDAY", "EVERYDAY"] as const;

export function parseOverride(body: unknown): ParsedOverride {
  const b = (body ?? {}) as Record<string, unknown>;
  const note = typeof b.note === "string" && b.note.trim() ? b.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) : null;
  const reportId = b.reportId == null ? null : int(b.reportId, 1, 999_999_999);
  if (b.reportId != null && reportId == null) return bad("INVALID_REPORT", "신고 번호가 올바르지 않습니다.");
  const p = (b.payload ?? {}) as Record<string, unknown>;
  if (b.kind === "FEE") {
    if (p.free === true) return { ok: true, kind: "FEE", payload: { free: true }, note, reportId };
    const baseMinutes = int(p.baseMinutes, 1, 1440), baseAmount = int(p.baseAmount, 0, 1_000_000);
    if (baseMinutes == null || baseAmount == null) return bad("INVALID_FEE", "기본시간(1~1440분)과 기본요금(0원 이상)을 입력하세요.");
    const hasAdd = p.addMinutes != null || p.addAmount != null;
    const addMinutes = hasAdd ? int(p.addMinutes, 1, 1440) : null, addAmount = hasAdd ? int(p.addAmount, 0, 1_000_000) : null;
    if (hasAdd && (addMinutes == null || addAmount == null)) return bad("INVALID_FEE", "추가 단위시간과 추가요금은 둘 다 입력하거나 둘 다 비워 두세요.");
    const dailyMax = p.dailyMax == null ? null : int(p.dailyMax, 1, 10_000_000);
    if (p.dailyMax != null && dailyMax == null) return bad("INVALID_FEE", "일 최대요금이 올바르지 않습니다.");
    if (baseAmount === 0 && !(addAmount! > 0)) return bad("INVALID_FEE", "전부 0원이면 '무료'로 지정하세요.");
    return { ok: true, kind: "FEE", payload: { free: false, baseMinutes, baseAmount, addMinutes, addAmount, dailyMax }, note, reportId };
  }
  if (b.kind === "HOURS") {
    if (!Array.isArray(p.rows) || p.rows.length === 0 || p.rows.length > 5) return bad("INVALID_HOURS", "운영시간을 한 줄 이상 입력하세요.");
    const rows: HoursRow[] = [];
    for (const r of p.rows as Array<Record<string, unknown>>) {
      if (!DAYS.includes(r?.dayType as never) || !["HOURS", "ALL_DAY", "CLOSED"].includes(r?.mode as never)) return bad("INVALID_HOURS", "요일 또는 운영 방식이 올바르지 않습니다.");
      if (rows.some((x) => x.dayType === r.dayType)) return bad("INVALID_HOURS", "같은 요일을 두 번 넣을 수 없습니다.");
      if (r.mode === "HOURS") {
        if (typeof r.open !== "string" || typeof r.close !== "string" || !TIME.test(r.open) || !TIME.test(r.close) || r.open === r.close || r.open === "24:00") return bad("INVALID_HOURS", "시각은 HH:MM 형식이고 여는 시각과 닫는 시각이 달라야 합니다.");
        rows.push({ dayType: r.dayType as HoursRow["dayType"], mode: "HOURS", open: r.open, close: r.close });
      } else rows.push({ dayType: r.dayType as HoursRow["dayType"], mode: r.mode as "ALL_DAY" | "CLOSED", open: null, close: null });
    }
    if (rows.some((r) => r.dayType === "EVERYDAY") && rows.length > 1) return bad("INVALID_HOURS", "'매일'은 다른 요일과 함께 쓸 수 없습니다.");
    return { ok: true, kind: "HOURS", payload: { rows }, note, reportId };
  }
  return bad("INVALID_KIND", "보정 종류가 올바르지 않습니다.");
}

type Snap = Array<Record<string, unknown>>;
const FEE_COLS = ["rule_type", "amount", "duration_minutes", "valid_day_type", "start_time", "end_time", "effective_from", "effective_to", "daily_max_basis", "free_flag", "source_record_id", "verified_at"];
const HOURS_COLS = ["day_type", "open_time", "close_time", "all_day_flag", "closed_flag", "holiday_policy", "source_record_id", "verified_at"];

async function snapshot(db: Db, lotId: number, kind: OverrideKind): Promise<Snap> {
  return kind === "FEE"
    ? db.all(`SELECT ${FEE_COLS.join(",")} FROM fee_rules WHERE parking_lot_id=? AND rule_type <> 'SEASON_PASS' ORDER BY id`, [lotId])
    : db.all(`SELECT ${HOURS_COLS.join(",")} FROM operating_schedules WHERE parking_lot_id=? ORDER BY id`, [lotId]);
}
async function writeRows(db: Db, lotId: number, kind: OverrideKind, rows: Snap) {
  if (kind === "FEE") { // 정기권은 보정 대상이 아니므로 남겨 둠
    await db.run("DELETE FROM fee_rules WHERE parking_lot_id=? AND rule_type <> 'SEASON_PASS'", [lotId]);
    for (const r of rows) await db.run(`INSERT INTO fee_rules(parking_lot_id, ${FEE_COLS.join(",")}) VALUES (?${",?".repeat(FEE_COLS.length)})`, [lotId, ...FEE_COLS.map((c) => (r[c] ?? null) as string | number | null)]);
  } else {
    await db.run("DELETE FROM operating_schedules WHERE parking_lot_id=?", [lotId]);
    for (const r of rows) await db.run(`INSERT INTO operating_schedules(parking_lot_id, ${HOURS_COLS.join(",")}) VALUES (?${",?".repeat(HOURS_COLS.length)})`, [lotId, ...HOURS_COLS.map((c) => (r[c] ?? null) as string | number | null)]);
  }
}
/** 보정 입력 → 저장 행. verified_at에 보정 시각을 남긴다 */
export function payloadRows(kind: OverrideKind, payload: FeePayload | HoursPayload, at: string): Snap {
  if (kind === "FEE") {
    const p = payload as FeePayload;
    if (p.free) return [{ rule_type: "FREE", valid_day_type: "EVERYDAY", free_flag: 1, verified_at: at }];
    const out: Snap = [{ rule_type: "BASE", amount: p.baseAmount, duration_minutes: p.baseMinutes, valid_day_type: "EVERYDAY", verified_at: at }];
    if (p.addMinutes != null && p.addAmount != null) out.push({ rule_type: "ADDITIONAL", amount: p.addAmount, duration_minutes: p.addMinutes, valid_day_type: "EVERYDAY", verified_at: at });
    if (p.dailyMax != null) out.push({ rule_type: "DAILY_MAX", amount: p.dailyMax, valid_day_type: "EVERYDAY", daily_max_basis: "CALENDAR_DAY", verified_at: at });
    return out;
  }
  return (payload as HoursPayload).rows.map((r) => ({ day_type: r.dayType, open_time: r.mode === "HOURS" ? r.open : null, close_time: r.mode === "HOURS" ? r.close : null, all_day_flag: r.mode === "ALL_DAY" ? 1 : 0, closed_flag: r.mode === "CLOSED" ? 1 : 0, verified_at: at }));
}

export interface OverrideRow { id: number; parking_lot_id: number; kind: OverrideKind; payload_json: string; source_snapshot_json: string; note: string | null; report_id: number | null; status: string; created_by: string; created_at: string; ended_by: string | null; ended_at: string | null }

/** 보정 적용. 같은 종류의 적용 중 보정이 있으면 대체(원천 스냅샷은 이어받음). 연결된 신고는 '확인'으로 처리 */
export async function applyOverride(db: Db, lotId: number, o: Extract<ParsedOverride, { ok: true }>, by: string, now = new Date(), clientKey?: string): Promise<{ ok: true; id: number } | { ok: false; code: "LOT_NOT_FOUND" | "REPORT_MISMATCH" }> {
  const at = now.toISOString();
  return db.transaction(async () => {
    if (!(await db.get("SELECT 1 AS x FROM parking_lots WHERE id=?", [lotId]))) return { ok: false as const, code: "LOT_NOT_FOUND" as const };
    if (o.reportId != null && !(await db.get("SELECT 1 AS x FROM lot_reports WHERE id=? AND parking_lot_id=?", [o.reportId, lotId]))) return { ok: false as const, code: "REPORT_MISMATCH" as const };
    const prev = await db.get<OverrideRow>("SELECT * FROM lot_overrides WHERE parking_lot_id=? AND kind=? AND status='ACTIVE'", [lotId, o.kind]);
    const snap = prev ? prev.source_snapshot_json : JSON.stringify(await snapshot(db, lotId, o.kind));
    if (prev) await db.run("UPDATE lot_overrides SET status='SUPERSEDED', ended_by=?, ended_at=? WHERE id=?", [by, at, prev.id]);
    await writeRows(db, lotId, o.kind, payloadRows(o.kind, o.payload, at));
    const id = (await db.run("INSERT INTO lot_overrides(parking_lot_id, kind, payload_json, source_snapshot_json, note, report_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [lotId, o.kind, JSON.stringify(o.payload), snap, o.note, o.reportId, by, at])).lastId;
    if (o.reportId != null) await db.run("UPDATE lot_reports SET status='REVIEWED', reviewed_by=?, reviewed_at=? WHERE id=? AND status='NEW'", [by, at, o.reportId]);
    await audit(db, `override:${o.kind.toLowerCase()}:apply`, "OK", clientKey ?? `cli:${by}`, `lot ${lotId} override ${id}`);
    return { ok: true as const, id };
  });
}

/** 되돌리기: 원천 스냅샷 복원 */
export async function revertOverride(db: Db, id: number, by: string, now = new Date(), clientKey?: string): Promise<boolean> {
  return db.transaction(async () => {
    const o = await db.get<OverrideRow>("SELECT * FROM lot_overrides WHERE id=? AND status='ACTIVE'", [id]);
    if (!o) { await audit(db, "override:revert", "REJECTED", clientKey ?? `cli:${by}`, `override ${id}`); return false; }
    await writeRows(db, o.parking_lot_id, o.kind, JSON.parse(o.source_snapshot_json) as Snap);
    await db.run("UPDATE lot_overrides SET status='REVERTED', ended_by=?, ended_at=? WHERE id=?", [by, now.toISOString(), id]);
    await audit(db, `override:${o.kind.toLowerCase()}:revert`, "OK", clientKey ?? `cli:${by}`, `lot ${o.parking_lot_id} override ${id}`);
    return true;
  });
}

/**
 * 수집이 시설의 요금·운영시간을 원천 값으로 다시 쓴 직후 호출: 새 원천 값을 스냅샷으로 저장하고 보정을 다시 적용.
 * @returns 다시 적용한 보정 수
 */
export async function reapplyOverrides(db: Db, lotIds: number[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < lotIds.length; i += 500) {
    const ids = lotIds.slice(i, i + 500);
    const rows = await db.all<OverrideRow>(`SELECT * FROM lot_overrides WHERE status='ACTIVE' AND parking_lot_id IN (${ids.map(() => "?").join(",")})`, ids);
    for (const o of rows) {
      await db.run("UPDATE lot_overrides SET source_snapshot_json=? WHERE id=?", [JSON.stringify(await snapshot(db, o.parking_lot_id, o.kind)), o.id]);
      await writeRows(db, o.parking_lot_id, o.kind, payloadRows(o.kind, JSON.parse(o.payload_json), o.created_at));
      n++;
    }
  }
  return n;
}

export async function activeOverrides(db: Db, lotId: number) {
  return db.all<{ id: number; kind: OverrideKind; note: string | null; created_by: string; created_at: string }>("SELECT id, kind, note, created_by, created_at FROM lot_overrides WHERE parking_lot_id=? AND status='ACTIVE' ORDER BY kind", [lotId]);
}
export async function listOverrides(db: Db, limit = 100) {
  return db.all<{ id: number; parking_lot_id: number; name: string; kind: OverrideKind; payload_json: string; note: string | null; report_id: number | null; status: string; created_by: string; created_at: string; ended_by: string | null; ended_at: string | null }>(
    `SELECT o.id, o.parking_lot_id, l.name, o.kind, o.payload_json, o.note, o.report_id, o.status, o.created_by, o.created_at, o.ended_by, o.ended_at
     FROM lot_overrides o JOIN parking_lots l ON l.id=o.parking_lot_id ORDER BY (o.status='ACTIVE') DESC, o.created_at DESC, o.id DESC LIMIT ?`, [limit]);
}
