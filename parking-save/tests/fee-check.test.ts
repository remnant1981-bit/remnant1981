import { describe, expect, it } from "vitest";
import { discountTargets, feeAnomalies } from "@/domain/fee-check";
import type { FeeRule } from "@/domain/fee";

const R = (t: FeeRule["ruleType"], amount: number, durationMinutes: number | null, dayType: FeeRule["dayType"] = "EVERYDAY"): FeeRule => ({ ruleType: t, amount, durationMinutes, dayType });

describe("요금 이상치", () => {
  it("정상 요금은 이상 없음(30분 500원 + 10분 200원, 일 최대 1만 원)", () => {
    expect(feeAnomalies([R("BASE", 500, 30), R("ADDITIONAL", 200, 10), R("DAILY_MAX", 10000, null)])).toEqual([]);
  });
  it("최초 30분 무료(기본 0원) 패턴은 이상 아님", () => {
    expect(feeAnomalies([R("BASE", 0, 30), R("ADDITIONAL", 300, 10)])).toEqual([]);
  });
  it("시간당 2만 원 초과", () => {
    expect(feeAnomalies([R("BASE", 50000, 60), R("ADDITIONAL", 500, 10)])).toContain("HOURLY_TOO_HIGH");
  });
  it("추가 단가가 기본의 15배 초과", () => {
    expect(feeAnomalies([R("BASE", 100, 60), R("ADDITIONAL", 2000, 60)])).toContain("ADD_RATE_JUMP");
  });
  it("일 최대요금 < 1시간 요금", () => {
    expect(feeAnomalies([R("BASE", 1000, 30), R("ADDITIONAL", 500, 10), R("DAILY_MAX", 1500, null)])).toContain("DAILY_MAX_BELOW_HOUR");
  });
  it("요일별 규칙은 같은 요일끼리만 비교", () => {
    expect(feeAnomalies([R("BASE", 100, 60, "WEEKDAY"), R("ADDITIONAL", 2000, 60, "SATURDAY")])).toEqual([]);
  });
});

describe("감면 안내", () => {
  it("대상 키워드를 고정 순서로", () => {
    expect(discountTargets("경차+장애인 차량 50프로 할인 등")).toEqual(["경차", "장애인"]);
    expect(discountTargets("요금면제(국가유공자, 다자녀)+50프로 감면(임산부, 경차, 저공해차)")).toEqual(["경차", "저공해·친환경차", "국가유공자", "다자녀", "임산부"]);
  });
  it("감면 문맥이 없거나 비어 있으면 없음", () => {
    expect(discountTargets("경차 전용 구역 있음")).toEqual([]);
    expect(discountTargets(null)).toEqual([]);
  });
});
