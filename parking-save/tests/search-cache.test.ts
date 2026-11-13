// 검색 결과 단기 캐시
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { parseSearchParams, type SearchParams } from "@/server/search";
import { resetSearchCacheForTest, searchCacheKey, searchCacheStats, searchLotsCached, SEARCH_CACHE_TTL_MS } from "@/server/search-cache";

const env = process.env as Record<string, string | undefined>;
let db: Db;
const params = (o: Record<string, string> = {}): SearchParams => {
  const r = parseSearchParams(new URLSearchParams({ lat: "37.5", lng: "127.0", startAt: "2026-11-16T10:00:00+09:00", endAt: "2026-11-16T12:00:00+09:00", ...o }));
  if (!r.ok) throw new Error(r.code); return r.params;
};
const addLot = (name: string) => db.run(
  "INSERT INTO parking_lots(source_name, source_record_id, name, parking_type, ownership_type, latitude, longitude, collected_at, data_status, created_at, updated_at) VALUES ('DATA_GO_KR_15012896',?,?,'OFF_STREET','PUBLIC',37.5,127.0,'2026-11-10T00:00:00Z','ACTIVE','2026-11-10T00:00:00Z','2026-11-10T00:00:00Z')", [name, name]);

beforeEach(async () => { db = await createSqliteDb(":memory:"); await migrate(db); await addLot("A"); resetSearchCacheForTest(); });
const mockOff = async (fn: () => Promise<void>) => { const s = env.PARKING_MOCK_DATA; env.PARKING_MOCK_DATA = "false"; try { await fn(); } finally { if (s === undefined) delete env.PARKING_MOCK_DATA; else env.PARKING_MOCK_DATA = s; } };

describe("검색 결과 캐시", () => {
  it("같은 조건은 30초 동안 다시 계산하지 않고, 지나면 새로 계산", () => mockOff(async () => {
    const t0 = new Date("2026-11-12T00:00:00Z");
    expect((await searchLotsCached(db, params(), t0)).items).toHaveLength(1);
    await addLot("B");
    expect((await searchLotsCached(db, params(), new Date(t0.getTime() + SEARCH_CACHE_TTL_MS - 1))).items).toHaveLength(1); // 캐시
    expect(searchCacheStats).toEqual({ hits: 1, misses: 1 });
    expect((await searchLotsCached(db, params(), new Date(t0.getTime() + SEARCH_CACHE_TTL_MS))).items).toHaveLength(2); // 만료
  }));
  it("조건이 하나라도 다르면 다른 결과(좌표·기간·정렬·필터·개수·언어)", () => mockOff(async () => {
    const base = searchCacheKey(params());
    const variants: Array<Record<string, string>> = [{ lat: "37.5001" }, { endAt: "2026-11-16T13:00:00+09:00" }, { sort: "distance_asc" }, { freeOnly: "true" }, { operatingOnly: "true" }, { limit: "20" }, { lang: "en" }, { radiusMeters: "500" }, { type: "on_street" }];
    for (const o of variants) expect(searchCacheKey(params(o))).not.toBe(base);
    expect(searchCacheKey(params({ lat: "37.50001" }))).toBe(base); // 소수 4자리(약 11m)까지 같은 위치
  }));
  it("같은 조건의 동시 요청은 한 번만 계산", () => mockOff(async () => {
    const now = new Date("2026-11-12T00:00:00Z");
    const [a, b] = await Promise.all([searchLotsCached(db, params(), now), searchLotsCached(db, params(), now)]);
    expect(a).toBe(b);
    expect(searchCacheStats).toEqual({ hits: 1, misses: 1 });
  }));
  it("목업 모드는 캐시하지 않음", async () => {
    const s = env.PARKING_MOCK_DATA; env.PARKING_MOCK_DATA = "true";
    try { await searchLotsCached(db, params()); await searchLotsCached(db, params()); expect(searchCacheStats).toEqual({ hits: 0, misses: 0 }); }
    finally { if (s === undefined) delete env.PARKING_MOCK_DATA; else env.PARKING_MOCK_DATA = s; }
  });
});
