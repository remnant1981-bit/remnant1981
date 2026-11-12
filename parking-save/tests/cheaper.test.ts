import { describe, expect, it } from "vitest";
import { cheaperShifts } from "@/domain/cheaper";
import { calculateFee, type FeeRule } from "@/domain/fee";
import type { ScheduleRow } from "@/domain/operating";

const kst = (s: string) => new Date(`${s}+09:00`);
// 평일 09~18시 유료(30분 1,000원 + 10분 300원), 18시 이후 무료
const rules: FeeRule[] = [
  { ruleType: "BASE", amount: 1000, durationMinutes: 30, dayType: "EVERYDAY" },
  { ruleType: "ADDITIONAL", amount: 300, durationMinutes: 10, dayType: "EVERYDAY" },
  { ruleType: "FREE", dayType: "EVERYDAY", startTime: "18:00", endTime: "09:00" },
];
const allDay: ScheduleRow[] = [{ dayType: "EVERYDAY", openTime: null, closeTime: null, allDay: true, closed: false }];
const now = kst("2026-11-13T08:00:00");
const base = (s: string, e: string) => { const r = calculateFee({ startAt: kst(s), endAt: kst(e), rules, holidays: new Set() }); if (r.status !== "OK") throw new Error(); return r.amount; };

describe("더 싼 시간대 제안", () => {
  it("무료 시간대에 걸치도록 늦추면 더 싸면 제안(많이 아끼는 순)", () => {
    const s = "2026-11-13T17:00:00", e = "2026-11-13T19:00:00";
    const r = cheaperShifts({ rules, schedules: allDay, holidays: new Set(), startAt: kst(s), endAt: kst(e), now, baseFee: base(s, e) });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].shiftMinutes).toBe(60);
    expect(r[0].fee).toBeLessThan(base(s, e));
    expect(r.every((x, i) => i === 0 || x.saving <= r[i - 1].saving)).toBe(true);
  });
  it("지난 시각으로 옮기는 제안은 하지 않음", () => {
    const s = "2026-11-13T08:30:00", e = "2026-11-13T10:30:00";
    const r = cheaperShifts({ rules, schedules: allDay, holidays: new Set(), startAt: kst(s), endAt: kst(e), now: kst("2026-11-13T08:20:00"), baseFee: base(s, e) });
    expect(r.every((x) => Date.parse(x.startAt) >= kst("2026-11-13T08:20:00").getTime())).toBe(true);
  });
  it("운영 외 시간으로 옮기는 대안·차이가 작은 대안은 제외", () => {
    const nine18: ScheduleRow[] = [{ dayType: "EVERYDAY", openTime: "09:00", closeTime: "19:00", allDay: false, closed: false }];
    const s = "2026-11-13T17:00:00", e = "2026-11-13T19:00:00";
    const r = cheaperShifts({ rules, schedules: nine18, holidays: new Set(), startAt: kst(s), endAt: kst(e), now, baseFee: base(s, e) });
    expect(r.every((x) => Date.parse(x.endAt) <= kst("2026-11-13T19:00:00").getTime())).toBe(true); // 19시 폐장 이후로 끝나는 대안 없음
    const flat: FeeRule[] = [{ ruleType: "BASE", amount: 1000, durationMinutes: 60, dayType: "EVERYDAY" }, { ruleType: "ADDITIONAL", amount: 1000, durationMinutes: 60, dayType: "EVERYDAY" }];
    expect(cheaperShifts({ rules: flat, schedules: allDay, holidays: new Set(), startAt: kst("2026-11-13T10:00:00"), endAt: kst("2026-11-13T12:00:00"), now, baseFee: 2000 })).toEqual([]);
  });
});
