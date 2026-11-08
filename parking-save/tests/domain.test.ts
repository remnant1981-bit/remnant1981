import { describe, expect, it } from "vitest";
import { distanceMeters, isValidCoord } from "@/domain/geo";
import { evaluateOccupancy } from "@/domain/occupancy";

describe("distance", () => {
  it("서울시청~강남역 약 8~9km", () => {
    const d = distanceMeters({ lat: 37.5663, lng: 126.9779 }, { lat: 37.4979, lng: 127.0276 });
    expect(d).toBeGreaterThan(8000);
    expect(d).toBeLessThan(10000);
  });
  it("동일 지점 0, 좌표 검증", () => {
    expect(distanceMeters({ lat: 37, lng: 127 }, { lat: 37, lng: 127 })).toBe(0);
    expect(isValidCoord({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoord({ lat: NaN, lng: 0 })).toBe(false);
    expect(isValidCoord({ lat: 37, lng: 127 })).toBe(true);
  });
});

describe("occupancy", () => {
  const now = new Date("2026-11-09T01:00:00Z");
  const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60000).toISOString();
  it("데이터 없음 → 확인 불가 (혼잡도 추정 안 함)", () => {
    expect(evaluateOccupancy({ totalSpaces: 100, availableSpaces: null, observedAt: iso(1) }, now)).toEqual({ status: "UNAVAILABLE", reason: "NO_DATA" });
    expect(evaluateOccupancy({ totalSpaces: null, availableSpaces: 5, observedAt: iso(1) }, now).status).toBe("UNAVAILABLE");
  });
  it("관측시각 없음/오래됨 → 확인 불가", () => {
    expect(evaluateOccupancy({ totalSpaces: 100, availableSpaces: 50, observedAt: null }, now)).toEqual({ status: "UNAVAILABLE", reason: "NO_OBSERVED_AT" });
    expect(evaluateOccupancy({ totalSpaces: 100, availableSpaces: 50, observedAt: iso(11) }, now)).toEqual({ status: "UNAVAILABLE", reason: "STALE" });
  });
  it("잔여 0은 유효한 만차(미제공과 구분)", () => {
    const r = evaluateOccupancy({ totalSpaces: 100, availableSpaces: 0, observedAt: iso(1) }, now);
    expect(r.status === "AVAILABLE" && r.congestion === "BUSY" && r.availableSpaces === 0).toBe(true);
  });
  it("비정상 값", () => {
    expect(evaluateOccupancy({ totalSpaces: 100, availableSpaces: 101, observedAt: iso(1) }, now).status).toBe("UNAVAILABLE");
    expect(evaluateOccupancy({ totalSpaces: 0, availableSpaces: 0, observedAt: iso(1) }, now).status).toBe("UNAVAILABLE");
  });
  it("구간", () => {
    const c = (a: number) => { const r = evaluateOccupancy({ totalSpaces: 100, availableSpaces: a, observedAt: iso(1) }, now); return r.status === "AVAILABLE" ? r.congestion : null; };
    expect([c(50), c(30), c(29), c(10), c(9)]).toEqual(["RELAXED", "RELAXED", "NORMAL", "NORMAL", "BUSY"]);
  });
});

describe("표시 문구", () => {
  it("출처 코드는 사람이 읽는 이름으로, 요금 규칙 없음은 무료가 아님을 명시", async () => {
    const { sourceLabel, feeText } = await import("@/lib/labels");
    expect(sourceLabel("DATA_GO_KR_15012896")).toContain("전국주차장정보표준데이터");
    expect(sourceLabel("SEOUL_OA21709")).toContain("서울 열린데이터광장");
    expect(sourceLabel("UNKNOWN_X")).toBe("UNKNOWN_X");
    const t = feeText({ status: "UNKNOWN", reason: "NO_RULES" });
    expect(t.main).toBe("요금 정보 없음");
    expect(t.sub).toContain("무료 아님");
    expect(t.sub).not.toBe(t.main);
  });
});
