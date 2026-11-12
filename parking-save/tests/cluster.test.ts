import { describe, expect, it } from "vitest";
import { clusterLabel, clusterPoints } from "@/domain/cluster";

describe("지도 핀 묶기", () => {
  it("반경 안의 점만 묶고, 묶음 좌표는 평균", () => {
    const r = clusterPoints([{ x: 0, y: 0, item: "a" }, { x: 10, y: 0, item: "b" }, { x: 100, y: 0, item: "c" }], 30);
    expect(r.map((c) => c.items)).toEqual([["a", "b"], ["c"]]);
    expect(r[0].x).toBe(5);
  });
  it("모든 점이 정확히 한 묶음에 속함", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: (i * 37) % 400, y: (i * 53) % 300, item: i }));
    const r = clusterPoints(pts, 40);
    expect(r.flatMap((c) => c.items).sort((a, b) => a - b)).toEqual(pts.map((p) => p.item));
  });
  it("라벨: 개수·무료 수·유료 최저가(계산 불가는 최저가에서 제외)", () => {
    expect(clusterLabel([{ tone: "free", amount: 0 }, { tone: "paid", amount: 3000 }, { tone: "paid", amount: 2300 }, { tone: "unknown", amount: null }])).toBe("4곳 · 무료 1 · 최저 2,300원");
    expect(clusterLabel([{ tone: "unknown", amount: null }, { tone: "unknown", amount: null }])).toBe("2곳");
  });
});
