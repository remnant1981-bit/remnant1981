import { describe, expect, it } from "vitest";
import { resolveKeyCollisions, type Candidate } from "@/collector/collisions";

const c = (key: string, name: string, lat: number | null, lng: number | null, date: string | null, seq: number): Candidate<string> => ({ key, lat, lng, date, seq, payload: name });
const names = (r: ReturnType<typeof resolveKeyCollisions<string>>) => r.items.map((x) => `${x.id}=${x.item.payload}`).sort();

describe("관리번호 반복 판정", () => {
  it("반복 없음: 그대로, 충돌 아님", () => {
    const r = resolveKeyCollisions([c("A", "a", 37, 127, "2026-01-01", 0), c("B", "b", 37, 127, "2026-01-01", 1)]);
    expect(r.items.every((x) => !x.collided)).toBe(true); expect(r.superseded).toBe(0); expect(r.split).toBe(0);
  });
  it("같은 장소(실데이터 광양 패턴: 같은 좌표, 기준일만 다름) → 기준일이 최신인 행만", () => {
    const old = c("K", "중동 1336(구)", 34.94, 127.69675, "2026-04-16", 0), neu = c("K", "중동 1336", 34.94, 127.69675, "2026-07-29", 1);
    for (const input of [[old, neu], [neu, old]]) {                       // 수집 순서와 무관
      const r = resolveKeyCollisions(input);
      expect(names(r)).toEqual(["K=중동 1336"]); expect(r.superseded).toBe(1); expect(r.split).toBe(0);
      expect(r.items[0].collided).toBe(true);
    }
  });
  it("기준일이 같으면 나중 행", () => {
    const a = c("K", "A", 37, 127, "2026-10-01", 0), b = c("K", "B", 37, 127, "2026-10-01", 1);
    expect(names(resolveKeyCollisions([a, b]))).toEqual(["K=B"]);
    expect(names(resolveKeyCollisions([{ ...b, seq: 0 }, { ...a, seq: 1 }]))).toEqual(["K=A"]); // seq가 곧 수집 순서
  });
  it("다른 장소(실데이터 영주 패턴: 한 번호로 여러 노상 주차장) → 모두 별도 시설로 보존, 첫 장소가 원래 번호 유지", () => {
    const rows = [c("K", "원당로", 36.8294, 128.6352, "2026-05-01", 0), c("K", "구성로", 36.8174, 128.6273, "2026-05-01", 1), c("K", "대동로", 36.8143, 128.6230, "2026-05-01", 2)];
    const r = resolveKeyCollisions(rows);
    expect(r.items).toHaveLength(3); expect(r.split).toBe(2); expect(r.superseded).toBe(0);
    expect(new Set(r.items.map((x) => x.id)).size).toBe(3);               // id 중복 없음
    expect(r.items.find((x) => x.id === "K")!.item.payload).toBe("대동로"); // 좌표가 가장 작은(위도 최소) 장소가 원래 번호
    // 수집 순서를 뒤집어도 같은 id ↔ 같은 시설
    const rev = resolveKeyCollisions([...rows].reverse().map((x, i) => ({ ...x, seq: i })));
    expect(names(rev)).toEqual(names(r));
  });
  it("혼합: 같은 장소 2행 + 다른 장소 1행 → 2개 시설(앞쪽은 최신 버전)", () => {
    const r = resolveKeyCollisions([
      c("K", "본점(구)", 37.0, 127.0, "2026-01-01", 0), c("K", "본점", 37.0001, 127.0001, "2026-06-01", 1), // ≈14m
      c("K", "분점", 37.01, 127.01, "2026-03-01", 2),
    ]);
    expect(r.items).toHaveLength(2); expect(r.superseded).toBe(1); expect(r.split).toBe(1);
    expect(names(r).some((x) => x.endsWith("=본점"))).toBe(true); expect(names(r).some((x) => x.endsWith("=분점"))).toBe(true);
    expect(names(r).some((x) => x.endsWith("=본점(구)"))).toBe(false);
  });
  it("50m 경계: 49m는 같은 장소, 약 111m는 다른 장소", () => {
    const base = 37.0, d = (m: number) => base + m / 111320;
    expect(resolveKeyCollisions([c("K", "a", base, 127, "2026-01-01", 0), c("K", "b", d(49), 127, "2026-02-01", 1)]).split).toBe(0);
    expect(resolveKeyCollisions([c("K", "a", base, 127, "2026-01-01", 0), c("K", "b", d(111), 127, "2026-02-01", 1)]).split).toBe(1);
  });
  it("좌표 없는 행은 첫 장소에 합쳐 데이터가 사라지지도, 새 시설이 생기지도 않음", () => {
    const r = resolveKeyCollisions([c("K", "좌표없음", null, null, "2026-09-01", 0), c("K", "좌표있음", 37, 127, "2026-01-01", 1)]);
    expect(r.items).toHaveLength(1); expect(r.superseded).toBe(1);
    expect(r.items[0].item.payload).toBe("좌표없음");                          // 기준일이 더 최신
    expect(resolveKeyCollisions([c("K", "a", null, null, null, 0), c("K", "b", null, null, null, 1)]).items).toHaveLength(1);
  });
  it("기준일을 모르는 행(null)은 기준일이 있는 행보다 우선하지 않음", () => {
    expect(names(resolveKeyCollisions([c("K", "날짜있음", 37, 127, "2026-01-01", 0), c("K", "날짜없음", 37, 127, null, 1)]))).toEqual(["K=날짜있음"]);
  });
});

describe("분리 시설 ID 유일성", () => {
  it("같은 소수 3자리 칸에 들어가는 서로 다른 장소(60m 간격)도 서로 다른 ID", () => {
    const mk = (lat: number, seq: number) => ({ key: "K1", lat, lng: 127.0, date: "2026-01-01", seq, payload: seq });
    // 위도 0.0006도 ≈ 67m: 50m 초과라 별도 장소, 소수 3자리로는 같은 칸(37.500)
    const r = resolveKeyCollisions([mk(37.5001, 0), mk(37.5007, 1), mk(37.5013, 2)]);
    const ids = r.items.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("K1");
    expect(r.split).toBe(2);
  });
});
