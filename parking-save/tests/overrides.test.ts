// 관리자 수동 보정: 검증·적용·수집 후 재적용·되돌리기·신고 연결
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { runSync } from "@/collector/runner";
import { applyOverride, listOverrides, parseOverride, revertOverride } from "@/server/overrides";
import { getLotDetail } from "@/server/search";
import type { RawRow, SourceAdapter } from "@/collector/types";

const row = (o: RawRow = {}): RawRow => ({ 주차장관리번호: "T-1", 주차장명: "보정 테스트", 주차장구분: "공영", 주차장유형: "노외", 소재지도로명주소: "서울특별시 중구 테스트로 1", 위도: "37.56", 경도: "126.97",
  운영요일: "평일+토요일+공휴일", 평일운영시작시각: "09:00", 평일운영종료시각: "18:00", 토요일운영시작시각: "09:00", 토요일운영종료시각: "18:00", 공휴일운영시작시각: "09:00", 공휴일운영종료시각: "18:00",
  요금정보: "유료", 주차기본시간: "30", 주차기본요금: "1000", 추가단위시간: "10", 추가단위요금: "500", 월정기권요금: "80000", 데이터기준일자: "2026-10-01", ...o });
const adapter = (r: RawRow): SourceAdapter => ({ sourceName: "STD", async *fetch() { yield r; } });
const fees = (db: Db, id: number) => db.all<{ rule_type: string; amount: number | null; duration_minutes: number | null; daily_max_basis: string | null }>("SELECT rule_type, amount, duration_minutes, daily_max_basis FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [id]);
const ok = (b: unknown) => { const p = parseOverride(b); if (!p.ok) throw new Error(p.code); return p; };
const FEE = { kind: "FEE", payload: { free: false, baseMinutes: 60, baseAmount: 2000, addMinutes: 30, addAmount: 1000, dailyMax: 15000 }, note: "현장 요금표 확인" };

let db: Db, lot: number;
beforeEach(async () => {
  db = await createSqliteDb(":memory:"); await migrate(db);
  await runSync(db, adapter(row()), new Date("2026-11-10T00:00:00Z"));
  lot = (await db.get<{ id: number }>("SELECT id FROM parking_lots"))!.id;
});

describe("보정 입력 검증", () => {
  it("요금: 무료 / 기본+추가+일 최대, 잘못된 값 거부", () => {
    expect(parseOverride({ kind: "FEE", payload: { free: true } })).toMatchObject({ ok: true });
    expect(parseOverride(FEE)).toMatchObject({ ok: true, note: "현장 요금표 확인" });
    for (const p of [{ free: false, baseMinutes: 0, baseAmount: 1000 }, { free: false, baseMinutes: 30, baseAmount: -1 }, { free: false, baseMinutes: 30, baseAmount: 1000, addMinutes: 10 },
      { free: false, baseMinutes: 30, baseAmount: 0 }, { free: false, baseMinutes: 30.5, baseAmount: 100 }, { free: false, baseMinutes: "30", baseAmount: 100 }, {}])
      expect(parseOverride({ kind: "FEE", payload: p }).ok).toBe(false);
    expect(parseOverride({ kind: "X", payload: {} }).ok).toBe(false);
  });
  it("운영시간: 형식·중복 요일·'매일' 혼용 거부", () => {
    expect(parseOverride({ kind: "HOURS", payload: { rows: [{ dayType: "EVERYDAY", mode: "ALL_DAY" }] } }).ok).toBe(true);
    expect(parseOverride({ kind: "HOURS", payload: { rows: [{ dayType: "WEEKDAY", mode: "HOURS", open: "08:00", close: "22:00" }, { dayType: "SUNDAY", mode: "CLOSED" }] } }).ok).toBe(true);
    for (const rows of [[], [{ dayType: "WEEKDAY", mode: "HOURS", open: "8시", close: "22:00" }], [{ dayType: "WEEKDAY", mode: "HOURS", open: "09:00", close: "09:00" }],
      [{ dayType: "WEEKDAY", mode: "ALL_DAY" }, { dayType: "WEEKDAY", mode: "CLOSED" }], [{ dayType: "EVERYDAY", mode: "ALL_DAY" }, { dayType: "SUNDAY", mode: "CLOSED" }], [{ dayType: "MONDAY", mode: "ALL_DAY" }]])
      expect(parseOverride({ kind: "HOURS", payload: { rows } }).ok).toBe(false);
  });
});

describe("보정 적용·되돌리기", () => {
  it("요금 보정: 규칙 교체(정기권 유지), 상세에 보정 표시, 되돌리면 원천 값 복원", async () => {
    const before = await fees(db, lot);
    const r = await applyOverride(db, lot, ok(FEE), "관리자A", new Date("2026-11-11T00:00:00Z"));
    expect(r.ok).toBe(true);
    expect(await fees(db, lot)).toEqual([
      { rule_type: "SEASON_PASS", amount: 80000, duration_minutes: null, daily_max_basis: null },
      { rule_type: "BASE", amount: 2000, duration_minutes: 60, daily_max_basis: null },
      { rule_type: "ADDITIONAL", amount: 1000, duration_minutes: 30, daily_max_basis: null },
      { rule_type: "DAILY_MAX", amount: 15000, duration_minutes: null, daily_max_basis: "CALENDAR_DAY" },
    ]);
    const d = await getLotDetail(db, lot, { startAt: new Date("2026-11-16T10:00:00+09:00"), endAt: new Date("2026-11-16T12:00:00+09:00") }, new Date("2026-11-12T00:00:00Z"));
    expect(d!.overrides).toMatchObject([{ kind: "FEE", created_by: "관리자A", note: "현장 요금표 확인" }]);
    expect(d!.monthlyPass).toBe(80000);
    if (!r.ok) return;
    expect(await revertOverride(db, r.id, "관리자B")).toBe(true);
    expect((await fees(db, lot)).map((x) => [x.rule_type, x.amount]).sort()).toEqual(before.map((x) => [x.rule_type, x.amount]).sort());
    expect(await revertOverride(db, r.id, "관리자B")).toBe(false); // 이미 되돌림
    expect((await listOverrides(db))[0]).toMatchObject({ status: "REVERTED", ended_by: "관리자B" });
  });

  it("수집이 원천 값을 다시 써도 보정이 유지되고, 되돌리면 '새' 원천 값으로 복원", async () => {
    const r = await applyOverride(db, lot, ok(FEE), "관리자A");
    const changed = row({ 주차기본요금: "1500", 데이터기준일자: "2026-11-01" }); // 원천 요금이 바뀜
    const s = await runSync(db, adapter(changed), new Date("2026-11-12T00:00:00Z"));
    expect(s).toMatchObject({ updated: 1, overridesReapplied: 1 });
    expect((await fees(db, lot)).find((x) => x.rule_type === "BASE")).toMatchObject({ amount: 2000, duration_minutes: 60 });
    // 변경 없는 재수집에서도 유지
    expect(await runSync(db, adapter(changed), new Date("2026-11-13T00:00:00Z"))).toMatchObject({ unchanged: 1, overridesReapplied: 0 });
    expect((await fees(db, lot)).find((x) => x.rule_type === "BASE")!.amount).toBe(2000);
    if (r.ok) await revertOverride(db, r.id, "관리자A");
    expect((await fees(db, lot)).find((x) => x.rule_type === "BASE")).toMatchObject({ amount: 1500, duration_minutes: 30 });
  });

  it("다시 보정하면 이전 보정은 대체되고 원천 스냅샷은 이어받음", async () => {
    await applyOverride(db, lot, ok(FEE), "A");
    const r2 = await applyOverride(db, lot, ok({ kind: "FEE", payload: { free: true } }), "B");
    expect((await fees(db, lot)).filter((x) => x.rule_type !== "SEASON_PASS").map((x) => x.rule_type)).toEqual(["FREE"]);
    expect((await listOverrides(db)).map((o) => o.status)).toEqual(["ACTIVE", "SUPERSEDED"]);
    if (r2.ok) await revertOverride(db, r2.id, "B");
    expect((await fees(db, lot)).find((x) => x.rule_type === "BASE")).toMatchObject({ amount: 1000, duration_minutes: 30 });
  });

  it("운영시간 보정과 신고 연결: 신고가 '확인'으로 처리되고, 다른 시설 신고는 거부", async () => {
    await db.run("INSERT INTO lot_reports(parking_lot_id, category, message, created_at) VALUES (?, 'HOURS', '24시간이에요', '2026-11-11T00:00:00Z')", [lot]);
    const rep = (await db.get<{ id: number }>("SELECT id FROM lot_reports"))!.id;
    const r = await applyOverride(db, lot, ok({ kind: "HOURS", payload: { rows: [{ dayType: "EVERYDAY", mode: "ALL_DAY" }] }, reportId: rep }), "관리자A");
    expect(r.ok).toBe(true);
    expect(await db.all("SELECT day_type, all_day_flag FROM operating_schedules WHERE parking_lot_id=?", [lot])).toEqual([{ day_type: "EVERYDAY", all_day_flag: 1 }]);
    expect(await db.get("SELECT status, reviewed_by FROM lot_reports WHERE id=?", [rep])).toEqual({ status: "REVIEWED", reviewed_by: "관리자A" });
    expect(await applyOverride(db, 999999, ok(FEE), "A")).toEqual({ ok: false, code: "LOT_NOT_FOUND" });
    await runSync(db, adapter(row({ 주차장관리번호: "T-2", 주차장명: "다른 곳" })), new Date("2026-11-12T00:00:00Z"));
    const other = (await db.get<{ id: number }>("SELECT id FROM parking_lots WHERE source_record_id='T-2'"))!.id;
    expect(await applyOverride(db, other, ok({ ...FEE, reportId: rep }), "A")).toEqual({ ok: false, code: "REPORT_MISMATCH" });
    expect((await db.all("SELECT action FROM admin_audit_logs WHERE action LIKE 'override:%'")).length).toBeGreaterThanOrEqual(1);
  });
});
