import { describe, expect, it } from "vitest";
import { calculateFee, type FeeRule } from "@/domain/fee";

const kst = (s: string) => new Date(s + "+09:00");
const H = new Set<string>();
const std: FeeRule[] = [
  { ruleType: "BASE", amount: 1000, durationMinutes: 30, dayType: "EVERYDAY", id: "b" },
  { ruleType: "ADDITIONAL", amount: 500, durationMinutes: 15, dayType: "EVERYDAY", id: "a" },
];
const run = (s: string, e: string, rules: FeeRule[], holidays: Set<string> | null = H) =>
  calculateFee({ startAt: kst(s), endAt: kst(e), rules, holidays });
const amt = (r: ReturnType<typeof run>) => (r.status === "OK" ? r.amount : r.reason);

describe("기본/추가 단위", () => {
  it("분 단위 경계", () => {
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:01", std))).toBe(1000);
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:30", std))).toBe(1000);
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:31", std))).toBe(1500); // 올림
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:45", std))).toBe(1500);
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:46", std))).toBe(2000);
  });
  it("기간 오류", () => {
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:00", std))).toBe("INVALID_PERIOD");
    expect(amt(run("2026-11-09T11:00", "2026-11-09T10:00", std))).toBe("INVALID_PERIOD");
  });
});

describe("규칙 누락/충돌 → 계산 불가 (0원 아님)", () => {
  it("규칙 없음", () => expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", []))).toBe("NO_RULES"));
  it("금액 미확인", () => {
    const r: FeeRule[] = [{ ruleType: "BASE", amount: null, durationMinutes: 30, dayType: "EVERYDAY" }];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", r))).toBe("INCOMPLETE_RULE");
  });
  it("추가요금 규칙 없이 기본 단위 초과", () => {
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", [std[0]]))).toBe("INCOMPLETE_RULE");
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:20", [std[0]]))).toBe(1000);
  });
  it("동일 유형 규칙 충돌", () => {
    const r: FeeRule[] = [...std, { ruleType: "BASE", amount: 2000, durationMinutes: 30, dayType: "EVERYDAY" }];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", r))).toBe("RULE_CONFLICT");
  });
  it("요일 구분 불명 규칙", () => {
    const r: FeeRule[] = [...std, { ruleType: "FREE", dayType: "UNKNOWN" }];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", r))).toBe("RULE_DAYTYPE_UNKNOWN");
  });
  it("시간대별 요금 차등은 미지원", () => {
    const r: FeeRule[] = [{ ...std[0], startTime: "09:00", endTime: "18:00" }, std[1]];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", r))).toBe("UNSUPPORTED_RULE");
  });
});

describe("무료 시간대", () => {
  const night: FeeRule[] = [...std, { ruleType: "FREE", dayType: "EVERYDAY", startTime: "22:00", endTime: "08:00" }];
  it("전 구간 무료 시 무료(명시 규칙 근거)", () => {
    const r = run("2026-11-09T23:00", "2026-11-10T06:00", night);
    expect(r.status === "OK" && r.isFree && r.amount === 0).toBe(true);
  });
  it("일부 구간만 무료 처리", () => {
    // 21:00~23:00 중 21~22 유료(60분→1000+2*500), 22~23 무료
    expect(amt(run("2026-11-09T21:00", "2026-11-09T23:00", night))).toBe(2000);
  });
  it("무료→유료 전환(07:30~08:30, 08시 이후 30분)", () => {
    expect(amt(run("2026-11-09T07:30", "2026-11-09T08:30", night))).toBe(1000);
  });
});

describe("자정·주말·공휴일", () => {
  it("자정 통과: 일별 내역 분리", () => {
    const r = run("2026-11-09T23:30", "2026-11-10T00:30", std);
    expect(r.status).toBe("OK");
    if (r.status === "OK") { expect(r.days.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10"]); expect(r.amount).toBe(2000); }
  });
  it("공휴일 데이터 없으면 요일별 규칙 적용 불가", () => {
    const r: FeeRule[] = [...std.map((x) => ({ ...x, dayType: "WEEKDAY" as const }))];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", r, null))).toBe("HOLIDAY_DATA_MISSING");
  });
  it("EVERYDAY 규칙만 있으면 공휴일 데이터 없이도 계산", () => {
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:30", std, null))).toBe(1000);
  });
  it("일요일 무료 + 평일 유료", () => {
    const r: FeeRule[] = [...std, { ruleType: "FREE", dayType: "SUNDAY" }];
    expect(amt(run("2026-11-08T10:00", "2026-11-08T20:00", r))).toBe(0); // 2026-11-08 = 일요일
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:30", r))).toBe(1000); // 월요일
  });
  it("공휴일 무료 근거 없으면 평일 규칙 대입 안 함 → 공휴일은 EVERYDAY만 적용", () => {
    const r: FeeRule[] = [
      { ruleType: "BASE", amount: 1000, durationMinutes: 30, dayType: "WEEKDAY" },
      { ruleType: "ADDITIONAL", amount: 500, durationMinutes: 15, dayType: "WEEKDAY" },
    ];
    // 2026-11-09 월요일을 공휴일로 지정 → 공휴일/매일 기본요금 규칙 없음
    expect(amt(run("2026-11-09T10:00", "2026-11-09T10:30", r, new Set(["2026-11-09"])))).toBe("INCOMPLETE_RULE");
  });
  it("공휴일 별도 규칙", () => {
    const r: FeeRule[] = [...std, { ruleType: "FREE", dayType: "HOLIDAY" }];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T12:00", r, new Set(["2026-11-09"])))).toBe(0);
  });
  it("평일↔주말 유료 단가 혼합은 미지원", () => {
    const r: FeeRule[] = [
      { ruleType: "BASE", amount: 1000, durationMinutes: 30, dayType: "WEEKDAY" },
      { ruleType: "ADDITIONAL", amount: 500, durationMinutes: 15, dayType: "WEEKDAY" },
      { ruleType: "BASE", amount: 500, durationMinutes: 30, dayType: "SUNDAY" },
      { ruleType: "ADDITIONAL", amount: 250, durationMinutes: 15, dayType: "SUNDAY" },
    ];
    expect(amt(run("2026-11-08T23:00", "2026-11-09T01:00", r))).toBe("UNSUPPORTED_RATE_CHANGE");
  });
});

describe("일일 최대요금", () => {
  const max: FeeRule[] = [...std, { ruleType: "DAILY_MAX", amount: 5000, dayType: "EVERYDAY", dailyMaxBasis: "CALENDAR_DAY" }];
  it("상한 적용", () => {
    const r = run("2026-11-09T08:00", "2026-11-09T20:00", max);
    expect(r.status === "OK" && r.amount === 5000 && r.days[0].capped).toBe(true);
  });
  it("상한 미만은 그대로", () => expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", max))).toBe(2000));
  it("날짜별 상한 각각 적용", () => {
    expect(amt(run("2026-11-09T00:00", "2026-11-10T12:00", max))).toBe(5000 + 5000);
  });
  it("기준 필드가 아예 없으면(null/undefined) 계속 계산 불가", () => {
    const r2: FeeRule[] = [...std, { ruleType: "DAILY_MAX", amount: 5000, dayType: "EVERYDAY" }];
    expect(amt(run("2026-11-09T10:00", "2026-11-09T11:00", r2))).toBe("UNSUPPORTED_DAILY_MAX_BASIS");
  });
  describe("기준 불명(UNKNOWN)/입차 24시간 상한 — 자정을 넘지 않는 단일 일자 이용에서만 (사용자 결정 2026-11-08)", () => {
    const unk: FeeRule[] = [...std, { ruleType: "DAILY_MAX", amount: 5000, dayType: "EVERYDAY", dailyMaxBasis: "UNKNOWN" }];
    it("상한이 걸리지 않으면 시간제 요금 그대로, 추정 표시 없음", () => {
      const r = run("2026-11-09T10:00", "2026-11-09T11:00", unk);
      expect(r.status === "OK" && r.amount === 2000 && r.assumptions.length === 0).toBe(true);
    });
    it("상한이 걸리면 낮은 값 + 추정 표시", () => {
      const r = run("2026-11-09T08:00", "2026-11-09T20:00", unk);
      expect(r.status).toBe("OK");
      if (r.status === "OK") { expect(r.amount).toBe(5000); expect(r.assumptions).toHaveLength(1); expect(r.assumptions[0]).toContain("추정"); }
    });
    it("입차 24시간 기준도 단일 일자에서는 동일하게 적용", () => {
      const r: FeeRule[] = [...std, { ruleType: "DAILY_MAX", amount: 5000, dayType: "EVERYDAY", dailyMaxBasis: "ENTRY_24H" }];
      expect(amt(run("2026-11-09T08:00", "2026-11-09T20:00", r))).toBe(5000);
    });
    it("자정까지(정확히 다음 자정 종료)는 단일 일자, 자정을 넘기면 계산 불가", () => {
      expect(amt(run("2026-11-09T22:00", "2026-11-10T00:00", unk))).toBe(4000); // 120분: 1000+6*500=4000 < 상한 5000
      expect(amt(run("2026-11-09T23:30", "2026-11-10T00:30", unk))).toBe("UNSUPPORTED_DAILY_MAX_BASIS");
      expect(amt(run("2026-11-09T10:00", "2026-11-10T10:00", unk))).toBe("UNSUPPORTED_DAILY_MAX_BASIS");
    });
    it("달력일 기준이 확인된 상한은 기존대로 날짜별 적용 + 추정 표시 없음", () => {
      const cal: FeeRule[] = [...std, { ruleType: "DAILY_MAX", amount: 5000, dayType: "EVERYDAY", dailyMaxBasis: "CALENDAR_DAY" }];
      const r = run("2026-11-09T08:00", "2026-11-09T20:00", cal);
      expect(r.status === "OK" && r.amount === 5000 && r.assumptions.length === 0).toBe(true);
    });
  });
});
