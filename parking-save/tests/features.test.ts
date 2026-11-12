// 즐겨찾기·최근 검색(브라우저 저장), 공유 링크 위치 축소
import { beforeEach, describe, expect, it } from "vitest";
import { shareUrl } from "@/components/ShareButton";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
const g = globalThis as unknown as { window?: unknown };

describe("즐겨찾기·최근 검색", () => {
  let store: MemStorage;
  beforeEach(() => { store = new MemStorage(); g.window = { localStorage: store, addEventListener() {}, removeEventListener() {} }; });

  it("즐겨찾기 토글·삭제·최대 개수, 같은 원문이면 같은 배열(렌더 안정성)", async () => {
    const s = await import("@/lib/saved");
    expect(s.toggleFavorite({ id: 1, name: "A", address: null })).toBe(true);
    expect(s.toggleFavorite({ id: 2, name: "B", address: "주소" })).toBe(true);
    expect(s.getFavorites().map((f) => f.id)).toEqual([2, 1]);
    expect(s.getFavorites()).toBe(s.getFavorites());
    expect(s.toggleFavorite({ id: 1, name: "A", address: null })).toBe(false);
    s.removeFavorite(2);
    expect(s.getFavorites()).toEqual([]);
    for (let i = 0; i < 40; i++) s.toggleFavorite({ id: 100 + i, name: `L${i}`, address: null });
    expect(s.getFavorites().length).toBe(s.MAX_FAVORITES);
  });

  it("최근 검색: 같은 조건은 맨 앞으로, 최대 5개, 지우기", async () => {
    const s = await import("@/lib/saved");
    for (let i = 0; i < 7; i++) s.recordSearch({ query: `q=${i}`, label: `L${i}`, period: "p" });
    expect(s.getRecent().map((r) => r.query)).toEqual(["q=6", "q=5", "q=4", "q=3", "q=2"]);
    s.recordSearch({ query: "q=3", label: "L3", period: "p" });
    expect(s.getRecent()[0].query).toBe("q=3");
    expect(s.getRecent().length).toBe(5);
    s.clearRecent();
    expect(s.getRecent()).toEqual([]);
  });

  it("깨진 값·형식이 다른 값·저장소 접근 오류는 빈 목록으로 처리", async () => {
    const s = await import("@/lib/saved");
    store.setItem("parkingsave:favorites:v1", "{not json");
    expect(s.getFavorites()).toEqual([]);
    store.setItem("parkingsave:favorites:v1", JSON.stringify([{ id: "x" }, { id: 3, name: "C", address: null }]));
    expect(s.getFavorites().map((f) => f.id)).toEqual([3]);
    g.window = { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }, addEventListener() {}, removeEventListener() {} };
    expect(s.getRecent()).toEqual([]);
    expect(() => s.recordSearch({ query: "a", label: "b", period: "c" })).not.toThrow();
  });
});

describe("공유 링크", () => {
  it("현재 위치 좌표를 소수 3자리(약 100m)로 줄이고 나머지 조건은 유지", () => {
    const u = new URL(shareUrl("https://x.test/search?lat=37.56634&lng=126.97794&start=2026-11-13T10:00&end=2026-11-13T12:00&view=map"));
    expect(u.searchParams.get("lat")).toBe("37.566");
    expect(u.searchParams.get("lng")).toBe("126.978");
    expect(u.searchParams.get("view")).toBe("map");
    expect(u.searchParams.get("start")).toBe("2026-11-13T10:00");
  });
  it("목적지 검색·상세 링크는 그대로", () => {
    const s = "https://x.test/lots/12?startAt=2026-11-13T10%3A00%3A00%2B09%3A00";
    expect(shareUrl(s)).toBe(s);
  });
});
