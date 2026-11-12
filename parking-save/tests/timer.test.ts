// 주차 타이머 계산(기기에서 실행되는 순수 계산 부분)과 상세의 요금 곡선
import { describe, expect, it } from "vitest";
import { timerStatus, type ParkingTimer } from "@/lib/parking-timer";
import type { FeeRule } from "@/domain/fee";

const rules: FeeRule[] = [
  { ruleType: "BASE", amount: 500, durationMinutes: 30, dayType: "EVERYDAY" },
  { ruleType: "ADDITIONAL", amount: 200, durationMinutes: 10, dayType: "EVERYDAY" },
  { ruleType: "DAILY_MAX", amount: 3000, dayType: "EVERYDAY", dailyMaxBasis: "CALENDAR_DAY" },
];
const start = Date.parse("2026-11-13T09:00:00+09:00");
const t = (over: Partial<ParkingTimer> = {}): ParkingTimer => ({ lotId: 1, name: "테스트", startedAt: new Date(start).toISOString(), rules, holidays: { from: "2026-11-13", to: "2026-11-16", dates: [] }, ...over });

describe("주차 타이머", () => {
  it("입차 직후에도 기본요금, 다음 인상은 기본시간 끝", () => {
    const s = timerStatus(t(), start + 10_000);
    expect(s).toMatchObject({ kind: "OK", elapsedMin: 0, fee: 500 });
    if (s.kind === "OK") expect(s.next).toEqual({ at: start + 30 * 60_000, fee: 700 });
  });
  it("경과 45분: 500 + 200×2 = 900원, 다음 인상 50분", () => {
    const s = timerStatus(t(), start + 45 * 60_000);
    expect(s).toMatchObject({ kind: "OK", elapsedMin: 45, fee: 900 });
    if (s.kind === "OK") expect(s.next).toEqual({ at: start + 50 * 60_000, fee: 1100 });
  });
  it("일 최대요금에 닿으면 그날 안에는 더 오르지 않고, 자정 이후 다시 오름", () => {
    const s = timerStatus(t(), start + 5 * 3600_000);
    expect(s).toMatchObject({ kind: "OK", fee: 3000 });
    if (s.kind === "OK") expect(s.next!.at).toBeGreaterThanOrEqual(Date.parse("2026-11-14T00:00:00+09:00"));
  });
  it("요일별 규칙인데 저장된 공휴일 범위를 벗어나면 계산하지 않음(추정 금지)", () => {
    const weekday: FeeRule[] = [{ ruleType: "BASE", amount: 500, durationMinutes: 30, dayType: "WEEKDAY" }, { ruleType: "FREE", dayType: "SATURDAY" }, { ruleType: "FREE", dayType: "SUNDAY" }, { ruleType: "FREE", dayType: "HOLIDAY" }];
    expect(timerStatus(t({ rules: weekday, holidays: null }), start + 60_000).kind).toBe("UNKNOWN");
    expect(timerStatus(t({ rules: weekday }), start + 60_000).kind).toBe("OK");
  });
});
