// 실사용 검토(2026-11-16)에서 발견한 결함 회귀 테스트
import { describe, expect, it } from "vitest";
import { operatingAt, operatingForStay, type ScheduleRow } from "@/domain/operating";
import { cheaperShifts } from "@/domain/cheaper";
import { parsePeriod } from "@/lib/time";

const T = (s: string) => Date.parse(s);
const NIGHT: ScheduleRow[] = [
  { dayType: "WEEKDAY", openTime: "18:00", closeTime: "02:00", allDay: false, closed: false },
  { dayType: "SATURDAY", openTime: null, closeTime: null, allDay: false, closed: true },
  { dayType: "SUNDAY", openTime: null, closeTime: null, allDay: false, closed: true },
  { dayType: "HOLIDAY", openTime: null, closeTime: null, allDay: false, closed: true },
];
const H = new Set<string>();

describe("자정을 넘는 운영시간", () => {
  it("금 20:00~토 01:00은 금요일(평일) 야간 운영으로 OPERATING", () => {
    expect(operatingForStay(NIGHT, T("2026-11-20T20:00:00+09:00"), T("2026-11-21T01:00:00+09:00"), H)).toBe("OPERATING");
  });
  it("월 01:00은 일요일(휴무) 밤의 연장이 아니므로 OUTSIDE", () => {
    expect(operatingAt(NIGHT, T("2026-11-23T01:00:00+09:00"), H)).toBe("OUTSIDE");
  });
  it("화 01:00은 월요일 밤 운영의 꼬리 → OPERATING, 화 03:00은 OUTSIDE", () => {
    expect(operatingAt(NIGHT, T("2026-11-24T01:00:00+09:00"), H)).toBe("OPERATING");
    expect(operatingAt(NIGHT, T("2026-11-24T03:00:00+09:00"), H)).toBe("OUTSIDE");
  });
  it("금 23:00~토 03:00은 02시에 닫으므로 OUTSIDE", () => {
    expect(operatingForStay(NIGHT, T("2026-11-20T23:00:00+09:00"), T("2026-11-21T03:00:00+09:00"), H)).toBe("OUTSIDE");
  });
  it("매일 09–18 같은 일반 시설은 기존과 동일", () => {
    const D: ScheduleRow[] = [{ dayType: "EVERYDAY", openTime: "09:00", closeTime: "18:00", allDay: false, closed: false }];
    expect(operatingForStay(D, T("2026-11-20T16:00:00+09:00"), T("2026-11-20T18:00:00+09:00"), H)).toBe("OPERATING");
    expect(operatingAt(D, T("2026-11-20T01:00:00+09:00"), H)).toBe("OUTSIDE");
  });
});

describe("시간 옮기기 제안", () => {
  it("운영시간을 모르면 제안하지 않음", () => {
    const rules = [{ dayType: "EVERYDAY", kind: "BASE", baseMinutes: 60, baseFee: 2000, unitMinutes: 60, unitFee: 2000 }] as never;
    const r = cheaperShifts({ rules, schedules: [], holidays: H, startAt: new Date(T("2026-11-20T16:00:00+09:00")), endAt: new Date(T("2026-11-20T18:00:00+09:00")), now: new Date(T("2026-11-19T00:00:00+09:00")), baseFee: 99999 });
    expect(r).toEqual([]);
  });
});

describe("주차 기간 검증(상세·비교·API 공통)", () => {
  it("31일 초과·역순·형식 오류는 null", () => {
    expect(parsePeriod("0001-01-01T00:00:00Z", "9999-12-31T00:00:00Z")).toBeNull();
    expect(parsePeriod("2026-11-20T10:00:00+09:00", "2026-11-20T09:00:00+09:00")).toBeNull();
    expect(parsePeriod("x", "y")).toBeNull();
    expect(parsePeriod("2026-11-01T00:00:00+09:00", "2026-12-02T00:00:00+09:00")).not.toBeNull();
    expect(parsePeriod("2026-11-01T00:00:00+09:00", "2026-12-02T00:01:00+09:00")).toBeNull();
  });
});

import { getTimer } from "@/lib/parking-timer";
describe("기기 저장 타이머 손상", () => {
  const set = (v: unknown) => { (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => JSON.stringify(v), setItem() {}, removeItem() {} } }; };
  const base = { lotId: 1, name: "a", startedAt: "2026-11-16T10:00:00+09:00", rules: [{ ruleType: "BASE", dayType: "EVERYDAY", amount: 1000, durationMinutes: 30 }], holidays: null };
  it("정상 값은 읽고, rules:[null]·holidays 형식 오류는 무시", () => {
    set(base); expect(getTimer()?.lotId).toBe(1);
    set({ ...base, rules: [null] }); expect(getTimer()).toBeNull();
    set({ ...base, holidays: { from: "a", to: "b" } }); expect(getTimer()).toBeNull();
    set({ ...base, startedAt: 5 }); expect(getTimer()).toBeNull();
    delete (globalThis as { window?: unknown }).window;
  });
});
