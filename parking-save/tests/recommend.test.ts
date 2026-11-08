import { describe, expect, it } from "vitest";
import { explainAll, FAR_METERS, type RecommendInput } from "@/domain/recommend";

const base = (o: Partial<RecommendInput> & { id: number }): RecommendInput => ({
  distanceMeters: 300, fee: { status: "OK", amount: 2000 }, operating: "OPERATING", occupancy: { status: "UNAVAILABLE" }, ownershipType: "PUBLIC", ...o,
});

describe("추천 사유", () => {
  it("무료는 규칙 근거로만, 먼 무료는 거리 유의점을 함께", () => {
    const m = explainAll([base({ id: 1, fee: { status: "OK", amount: 0, isFree: true }, distanceMeters: FAR_METERS + 100 }), base({ id: 2 })]);
    expect(m.get(1)!.highlights[0]).toContain("무료");
    expect(m.get(1)!.cautions.join()).toContain("다소 멉니다");
    expect(m.get(2)!.cautions).toEqual([]);
  });
  it("최저 요금은 비교 대상(요금 계산 가능한 유료)이 2곳 이상일 때만", () => {
    const one = explainAll([base({ id: 1 }), base({ id: 2, fee: { status: "UNKNOWN" } })]);
    expect(one.get(1)!.highlights.join()).not.toContain("최저");
    const two = explainAll([base({ id: 1, fee: { status: "OK", amount: 1500 } }), base({ id: 2, fee: { status: "OK", amount: 3000 } })]);
    expect(two.get(1)!.highlights.join()).toContain("최저");
    expect(two.get(2)!.highlights.join()).not.toContain("최저");
  });
  it("요금 정보 없음은 가격 비교 제외를 명시하되 감점·'최저' 후보에는 안 들어감", () => {
    const m = explainAll([base({ id: 1, fee: { status: "UNKNOWN" } }), base({ id: 2 }), base({ id: 3, fee: { status: "OK", amount: 1000 } })]);
    expect(m.get(1)!.cautions.join()).toContain("요금 비교에서 제외");
    expect(m.get(1)!.highlights.join()).not.toContain("최저");
    expect(m.get(3)!.highlights.join()).toContain("최저");
  });
  it("실시간: 미제공은 사유 없음(감점 아님), 혼잡은 유의점, 여유는 장점", () => {
    const m = explainAll([
      base({ id: 1 }),
      base({ id: 2, occupancy: { status: "AVAILABLE", availableSpaces: 3, congestion: "BUSY" } }),
      base({ id: 3, occupancy: { status: "AVAILABLE", availableSpaces: 120, congestion: "RELAXED" } }),
    ]);
    expect([...m.get(1)!.highlights, ...m.get(1)!.cautions].join()).not.toContain("실시간");
    expect(m.get(2)!.cautions.join()).toContain("혼잡");
    expect(m.get(3)!.highlights.join()).toContain("실시간 여유");
  });
  it("운영 외/미확인·공영 미확인 유의점, 가장 가까움은 2곳 이상일 때", () => {
    const m = explainAll([base({ id: 1, distanceMeters: 100, operating: "OUTSIDE" }), base({ id: 2, operating: "UNKNOWN", ownershipType: "UNKNOWN" })]);
    expect(m.get(1)!.highlights.join()).toContain("가장 가까움");
    expect(m.get(1)!.cautions.join()).toContain("운영시간 밖");
    expect(m.get(2)!.cautions.join()).toContain("운영시간 정보 없음");
    expect(m.get(2)!.cautions.join()).toContain("공영 여부 미확인");
    expect(explainAll([base({ id: 1 })]).get(1)!.highlights.join()).not.toContain("가장 가까움");
  });
  it("단정 표현('최적', '1위') 금지", () => {
    const all = [...explainAll([base({ id: 1 }), base({ id: 2, fee: { status: "OK", amount: 0, isFree: true } })]).values()].flatMap((e) => [...e.highlights, ...e.cautions]).join(" ");
    expect(all).not.toMatch(/최적|1위|추천 1/);
  });
});
