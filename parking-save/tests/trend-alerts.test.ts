// 혼잡 경향(시간대별 평균 빈자리)과 주차 타이머 알림 계획
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dayKind, occupancyTrend, TREND_MIN_DAYS, type HourlyRow } from "@/domain/occupancy-trend";
import { nextClosingAt, timerAlerts, type ParkingTimer } from "@/lib/parking-timer";
import type { FeeRule } from "@/domain/fee";
import { createSqliteDb, migrate } from "@/server/db";
import { syncSeoulOccupancy } from "@/collector/seoul-sync";
import { occupancyTrendFor } from "@/server/search";

const CFG = { relaxedAtOrAbovePct: 30, busyBelowPct: 10 };
const noHol = () => new Set<string>();

describe("혼잡 경향", () => {
  it("요일 유형: 토·일·공휴일=주말, 평일인데 공휴일 정보 없으면 판정 불가", () => {
    expect(dayKind("2026-11-14", null)).toBe("WEEKEND"); // 토
    expect(dayKind("2026-11-16", new Set())).toBe("WEEKDAY"); // 월
    expect(dayKind("2026-11-16", null)).toBeNull();
    expect(dayKind("2026-12-25", new Set(["2026-12-25"]))).toBe("WEEKEND"); // 성탄절(금)
  });

  const weekdays = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  it(`같은 요일 유형·시간대 관측일이 ${TREND_MIN_DAYS}일 미만이면 표시 안 함`, () => {
    const rows: HourlyRow[] = weekdays.slice(0, 3).map((ymd) => ({ ymd, hour: 10, ratioSum: 0.5, samples: 1 }));
    expect(occupancyTrend(rows, { kind: "WEEKDAY", hour: 10 }, noHol, CFG)).toBeNull();
  });
  it("날짜별 평균의 평균(관측 많은 날 과대 반영 안 함), 다른 시간·주말은 제외", () => {
    const rows: HourlyRow[] = [
      { ymd: weekdays[0], hour: 10, ratioSum: 0.05 * 12, samples: 12 }, // 5% (관측 12회)
      ...weekdays.slice(1, 4).map((ymd) => ({ ymd, hour: 10, ratioSum: 0.45, samples: 1 })), // 45% ×3
      { ymd: weekdays[4], hour: 11, ratioSum: 0, samples: 5 },
      { ymd: "2026-11-07", hour: 10, ratioSum: 0, samples: 5 }, // 토요일
    ];
    expect(occupancyTrend(rows, { kind: "WEEKDAY", hour: 10 }, noHol, CFG)).toEqual({ kind: "WEEKDAY", hour: 10, availablePct: 35, days: 4, level: "RELAXED" });
  });
  it("공휴일 정보가 없는 평일은 경향 계산에서 제외(공휴일이었을 수 있음)", () => {
    const rows: HourlyRow[] = weekdays.slice(0, 4).map((ymd) => ({ ymd, hour: 9, ratioSum: 0.05, samples: 1 }));
    expect(occupancyTrend(rows, { kind: "WEEKDAY", hour: 9 }, () => null, CFG)).toBeNull();
    expect(occupancyTrend(rows, { kind: "WEEKDAY", hour: 9 }, noHol, CFG)?.level).toBe("BUSY");
  });

  it("서울 수집 시 시간별 집계가 쌓이고, 상세 경향은 충분히 쌓였을 때만", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const BODY = fs.readFileSync(path.resolve(import.meta.dirname, "fixtures/seoul-getparkinginfo.sample.json"), "utf8");
    await syncSeoulOccupancy(db, async () => BODY, new Date("2026-11-08T10:33:30+09:00"));
    const rows = await db.all<{ ymd: string; hour: number; samples: number }>("SELECT ymd, hour, samples FROM occupancy_hourly");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ymd === "2026-11-08" && r.hour === 10 && r.samples === 1)).toBe(true);
    // 오래된 관측(수집 시점과 1시간 차이)은 집계하지 않음
    const before = (await db.get<{ n: number }>("SELECT SUM(samples) n FROM occupancy_hourly"))!.n;
    await syncSeoulOccupancy(db, async () => BODY, new Date("2026-11-08T11:40:00+09:00"));
    expect((await db.get<{ n: number }>("SELECT SUM(samples) n FROM occupancy_hourly"))!.n).toBe(before);

    const lot = (await db.get<{ id: number }>("SELECT parking_lot_id id FROM occupancy_hourly LIMIT 1"))!.id;
    const now = new Date("2026-11-12T12:00:00+09:00"), target = new Date("2026-11-16T10:30:00+09:00"); // 월 10시대
    expect(await occupancyTrendFor(db, lot, target, now)).toBeNull(); // 공휴일 커버리지 없음 + 일요일 1일뿐
    await db.run("INSERT INTO holiday_coverage(source_name, from_date, to_date, collected_at) VALUES ('T','2026-01-01','2026-12-31', ?)", [now.toISOString()]);
    for (const ymd of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"])
      await db.run("INSERT INTO occupancy_hourly(parking_lot_id, ymd, hour, ratio_sum, samples) VALUES (?,?,10,0.2,1)", [lot, ymd]);
    expect(await occupancyTrendFor(db, lot, target, now)).toEqual({ kind: "WEEKDAY", hour: 10, availablePct: 20, days: 4, level: "NORMAL" });
  });
});

const rules: FeeRule[] = [
  { ruleType: "BASE", amount: 500, durationMinutes: 30, dayType: "EVERYDAY" },
  { ruleType: "ADDITIONAL", amount: 200, durationMinutes: 10, dayType: "EVERYDAY" },
];
const start = Date.parse("2026-11-13T17:00:00+09:00"); // 금
const timer = (over: Partial<ParkingTimer> = {}): ParkingTimer => ({ lotId: 1, name: "테스트", startedAt: new Date(start).toISOString(), rules, holidays: { from: "2026-11-13", to: "2026-11-16", dates: [] },
  schedules: [{ dayType: "EVERYDAY", openTime: "09:00", closeTime: "18:00", allDay: false, closed: false }], ...over });

describe("주차 타이머 알림", () => {
  it("운영 종료 시각: 18:00, 운영시간 정보 없거나 이미 운영 외면 없음", () => {
    expect(nextClosingAt(timer(), start + 10 * 60_000)).toBe(Date.parse("2026-11-13T18:00:00+09:00"));
    expect(nextClosingAt(timer({ schedules: undefined }), start)).toBeNull();
    expect(nextClosingAt(timer(), Date.parse("2026-11-13T19:00:00+09:00"))).toBeNull();
    // 요일별 일정인데 공휴일 범위 밖이면 단정하지 않음
    expect(nextClosingAt(timer({ holidays: null, schedules: [{ dayType: "WEEKDAY", openTime: "09:00", closeTime: "18:00", allDay: false, closed: false }] }), start)).toBeNull();
  });
  it("알림 계획: 인상 10분 전, 종료 30분 전(시간순)", () => {
    const a = timerAlerts(timer(), start + 60_000);
    expect(a).toEqual([
      { kind: "FEE_UP", at: start + 30 * 60_000, notifyAt: start + 20 * 60_000, fee: 700 },
      { kind: "CLOSING", at: start + 60 * 60_000, notifyAt: start + 30 * 60_000 },
    ]);
  });
  it("요금 계산 불가면 인상 알림 없음(종료 알림만)", () => {
    const a = timerAlerts(timer({ rules: [] }), start + 60_000);
    expect(a.map((x) => x.kind)).toEqual(["CLOSING"]);
  });
});
