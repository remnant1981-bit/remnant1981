import { describe, expect, it } from "vitest";
import { seasonPassHint } from "@/domain/season-pass";

describe("월정기권 안내", () => {
  const D = 1440;
  it("7일 미만 이용은 안내하지 않음", () => expect(seasonPassHint({ pass: 60000, stayMinutes: 6 * D, fee: 100000 })).toBeNull());
  it("장기 이용에서 예상 요금이 정기권보다 비싸면 안내", () => expect(seasonPassHint({ pass: 60000, stayMinutes: 10 * D, fee: 90000 })).toEqual({ kind: "CHEAPER", pass: 60000, fee: 90000 }));
  it("정기권이 더 비싸면 안내하지 않음", () => expect(seasonPassHint({ pass: 60000, stayMinutes: 10 * D, fee: 30000 })).toBeNull());
  it("요금 계산 불가인 장기 이용은 '정기권도 확인' 안내", () => expect(seasonPassHint({ pass: 60000, stayMinutes: 14 * D, fee: null })).toEqual({ kind: "CHECK", pass: 60000 }));
  it("정기권 정보 없으면 없음", () => expect(seasonPassHint({ pass: null, stayMinutes: 30 * D, fee: null })).toBeNull());
});
