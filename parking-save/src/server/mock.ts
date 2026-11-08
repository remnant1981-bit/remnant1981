// ⚠ 목업 데이터: 실제 주차장이 아님. 이름·좌표·요금·면수 모두 가상(좌표는 서울 도심 부근).
// 실제 원천(공공데이터포털 등) 연동 전까지 UI/API 개발·시연용. source_name = 'MOCK'.
import type { Db } from "./db";

export const MOCK_SOURCE = "MOCK";
/** 실서비스 데이터가 아닌 원천(목업/샘플 픽스처). UI에서 목업·샘플로 표시 */
export const NON_PRODUCTION_SOURCES: string[] = [MOCK_SOURCE, "STANDARD_SAMPLE"];
export const mockEnabled = () => process.env.PARKING_MOCK_DATA !== "false";

/** 목업 목적지 지오코더(실제 지오코딩 아님 — OPEN_ISSUES D7). 좌표는 대략값 */
export const MOCK_PLACES: Record<string, { lat: number; lng: number }> = {
  "서울시청": { lat: 37.5663, lng: 126.9779 },
  "광화문": { lat: 37.5759, lng: 126.9769 },
  "서울역": { lat: 37.5547, lng: 126.9707 },
  "을지로입구": { lat: 37.566, lng: 126.9826 },
};

interface MockRule { t: "BASE" | "ADDITIONAL" | "DAILY_MAX" | "FREE"; amount?: number; dur?: number; day: string; s?: string; e?: string }
interface MockSched { day: string; open?: string; close?: string; allDay?: boolean }
interface MockLot {
  key: string; name: string; type: "ON_STREET" | "OFF_STREET" | "UNKNOWN"; ownership: "PUBLIC" | "UNKNOWN";
  lat: number; lng: number; total: number | null; address: string;
  rules: MockRule[]; sched: MockSched[];
  occ?: { available: number; total: number; ageMinutes: number };
}
const STD: MockRule[] = [
  { t: "BASE", amount: 1000, dur: 30, day: "EVERYDAY" },
  { t: "ADDITIONAL", amount: 500, dur: 15, day: "EVERYDAY" },
];
export const MOCK_LOTS: MockLot[] = [
  { key: "m1", name: "[목업] 시청앞 노외 A", type: "OFF_STREET", ownership: "PUBLIC", lat: 37.5668, lng: 126.9785, total: 320, address: "서울 중구 (가상 주소 1)",
    rules: [...STD, { t: "DAILY_MAX", amount: 20000, day: "EVERYDAY" }], sched: [{ day: "EVERYDAY", allDay: true }], occ: { available: 45, total: 320, ageMinutes: 2 } },
  { key: "m2", name: "[목업] 덕수궁길 노상", type: "ON_STREET", ownership: "PUBLIC", lat: 37.5651, lng: 126.9752, total: 40, address: "서울 중구 (가상 주소 2)",
    rules: [
      { t: "BASE", amount: 1200, dur: 30, day: "WEEKDAY" }, { t: "ADDITIONAL", amount: 600, dur: 10, day: "WEEKDAY" },
      { t: "BASE", amount: 1200, dur: 30, day: "SATURDAY" }, { t: "ADDITIONAL", amount: 600, dur: 10, day: "SATURDAY" },
      { t: "FREE", day: "EVERYDAY", s: "20:00", e: "09:00" }, { t: "FREE", day: "SUNDAY" }, { t: "FREE", day: "HOLIDAY" },
    ], sched: [{ day: "EVERYDAY", allDay: true }] },
  { key: "m3", name: "[목업] 청계천 무료개방 주차장", type: "OFF_STREET", ownership: "PUBLIC", lat: 37.5693, lng: 126.9801, total: 120, address: "서울 종로구 (가상 주소 3)",
    rules: [{ t: "FREE", day: "EVERYDAY" }], sched: [{ day: "EVERYDAY", open: "06:00", close: "22:00" }] },
  { key: "m4", name: "[목업] 서소문 공영 (요금·면수 정보 없음)", type: "OFF_STREET", ownership: "PUBLIC", lat: 37.5636, lng: 126.9738, total: null, address: "서울 중구 (가상 주소 4)", rules: [], sched: [] },
  { key: "m5", name: "[목업] 남대문 공영 (실시간 오래됨)", type: "OFF_STREET", ownership: "PUBLIC", lat: 37.5593, lng: 126.9775, total: 210, address: "서울 중구 (가상 주소 5)",
    rules: STD, sched: [{ day: "EVERYDAY", open: "07:00", close: "23:00" }], occ: { available: 12, total: 210, ageMinutes: 180 } },
  { key: "m6", name: "[목업] 을지로 주차장 (공영 여부·유형 미확인)", type: "UNKNOWN", ownership: "UNKNOWN", lat: 37.5662, lng: 126.9853, total: 80, address: "서울 중구 (가상 주소 6)",
    rules: [{ t: "BASE", amount: 2000, dur: 60, day: "EVERYDAY" }, { t: "ADDITIONAL", amount: 1000, dur: 30, day: "EVERYDAY" }], sched: [] },
  { key: "m7", name: "[목업] 서울역 노외 (혼잡)", type: "OFF_STREET", ownership: "PUBLIC", lat: 37.5557, lng: 126.9717, total: 600, address: "서울 용산구 (가상 주소 7)",
    rules: [...STD, { t: "DAILY_MAX", amount: 15000, day: "EVERYDAY" }], sched: [{ day: "EVERYDAY", allDay: true }], occ: { available: 3, total: 600, ageMinutes: 1 } },
  { key: "m8", name: "[목업] 광화문 공영 (요금 규칙 불명확)", type: "OFF_STREET", ownership: "PUBLIC", lat: 37.5749, lng: 126.9763, total: 150, address: "서울 종로구 (가상 주소 8)",
    rules: [{ t: "BASE", amount: 1000, dur: 30, day: "UNKNOWN" }], sched: [{ day: "EVERYDAY", allDay: true }] },
];

const iso = (d: Date) => d.toISOString();

/** 비어 있으면 목업 데이터 적재 (이미 데이터가 있으면 아무것도 하지 않음) */
export async function ensureMockData(db: Db, now = new Date()): Promise<void> {
  if (!mockEnabled()) return;
  const n = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM parking_lots WHERE source_name = ?", [MOCK_SOURCE]);
  if (n && n.c > 0) return;
  const t = iso(now);
  for (const l of MOCK_LOTS) {
    const r = await db.run(
      `INSERT INTO parking_lots(source_name, source_record_id, name, parking_type, ownership_type, address, latitude, longitude, total_spaces,
         source_url, source_updated_at, collected_at, data_status, quality_flags, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,'MOCK','["MOCK_DATA"]',?,?)`,
      [MOCK_SOURCE, l.key, l.name, l.type, l.ownership, l.address, l.lat, l.lng, l.total, t, t, t, t]);
    void r;
    const id = (await db.get<{ id: number }>("SELECT id FROM parking_lots WHERE source_name=? AND source_record_id=?", [MOCK_SOURCE, l.key]))!.id;
    for (const f of l.rules) {
      await db.run(
        `INSERT INTO fee_rules(parking_lot_id, rule_type, amount, duration_minutes, valid_day_type, start_time, end_time, daily_max_basis, free_flag, source_record_id, verified_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`,
        [id, f.t, f.amount ?? null, f.dur ?? null, f.day, f.s ?? null, f.e ?? null, f.t === "DAILY_MAX" ? "CALENDAR_DAY" : null, f.t === "FREE" ? 1 : null, l.key]);
    }
    for (const s of l.sched) {
      await db.run(
        "INSERT INTO operating_schedules(parking_lot_id, day_type, open_time, close_time, all_day_flag, closed_flag, source_record_id) VALUES (?,?,?,?,?,0,?)",
        [id, s.day, s.open ?? null, s.close ?? null, s.allDay ? 1 : 0, l.key]);
    }
  }
  // 공휴일: 2026-11~12 범위에서만 "완전"하다고 표시(실제 12/25 성탄절 1건). 이 밖의 기간은 공휴일 판정 불가.
  await db.run("INSERT OR IGNORE INTO holidays(date, name, source_name, collected_at) VALUES ('2026-12-25','성탄절',?,?)", [MOCK_SOURCE, t]);
  await db.run("INSERT OR IGNORE INTO holiday_coverage(source_name, from_date, to_date, collected_at) VALUES (?,?,?,?)", [MOCK_SOURCE, "2026-11-01", "2026-12-31", t]);
  await refreshMockOccupancy(db, now);
}

/** 목업 실시간 스냅샷 갱신: 검색 시점 기준 ageMinutes 전 관측으로 생성(실제 실시간 아님) */
export async function refreshMockOccupancy(db: Db, now = new Date()): Promise<void> {
  if (!mockEnabled()) return;
  await db.run("DELETE FROM occupancy_snapshots WHERE source_name = ?", [MOCK_SOURCE]);
  await db.run("UPDATE holiday_coverage SET collected_at = ? WHERE source_name = ?", [iso(now), MOCK_SOURCE]); // 목업 공휴일은 항상 최신으로 취급
  for (const l of MOCK_LOTS) {
    if (!l.occ) continue;
    const row = await db.get<{ id: number }>("SELECT id FROM parking_lots WHERE source_name=? AND source_record_id=?", [MOCK_SOURCE, l.key]);
    if (!row) continue;
    const observed = iso(new Date(now.getTime() - l.occ.ageMinutes * 60000));
    await db.run(
      "INSERT INTO occupancy_snapshots(parking_lot_id,total_spaces,available_spaces,observed_at,collected_at,source_name,validity_status) VALUES (?,?,?,?,?,?,'MOCK')",
      [row.id, l.occ.total, l.occ.available, observed, iso(now), MOCK_SOURCE]);
  }
}
