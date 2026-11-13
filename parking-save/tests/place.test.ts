// 목적지 검색(보유 주소 데이터 기반)·한눈에 보기·도보 시간 추정
import { describe, expect, it } from "vitest";
import { createSqliteDb, migrate } from "@/server/db";
import { resolveDestination } from "@/server/place";
import { parseSearchParams, pickHighlights, searchLots, type LotItem } from "@/server/search";
import { walkMinutesEstimate } from "@/domain/geo";

async function seed() {
  const db = await createSqliteDb(":memory:"); await migrate(db);
  const ins = (name: string, road: string, lat: number, lng: number, src = "DATA_GO_KR_15012896") => db.run(
    "INSERT INTO parking_lots(source_name, source_record_id, name, parking_type, ownership_type, road_address, latitude, longitude, collected_at, data_status, created_at, updated_at) VALUES (?,?,?,'OFF_STREET','PUBLIC',?,?,?,'2026-11-10T00:00:00Z','ACTIVE','2026-11-10T00:00:00Z','2026-11-10T00:00:00Z')",
    [src, name, name, road, lat, lng]);
  await ins("역삼1 공영", "서울특별시 강남구 역삼동 1", 37.500, 127.036);
  await ins("역삼2 공영", "서울특별시 강남구 역삼동 2", 37.502, 127.038);
  await ins("역삼3 공영", "서울특별시 강남구 역삼동 3", 37.504, 127.040);
  await ins("중앙로 공영", "대전광역시 중구 중앙로 10", 36.328, 127.427);
  await ins("중앙로A", "경기도 수원시 팔달구 중앙로 5", 37.270, 127.000);
  await ins("중앙로B", "경기도 수원시 팔달구 중앙로 9", 37.272, 127.002);
  await ins("100%_할인", "부산광역시 중구 광복로 1", 35.10, 129.03);
  await ins("가짜 역삼동", "서울특별시 강남구 역삼동 9", 10, 10, "MOCK");
  return db;
}
const env = process.env as Record<string, string | undefined>;
const withMockOff = async <T,>(fn: () => Promise<T>) => { const s = env.PARKING_MOCK_DATA; env.PARKING_MOCK_DATA = "false"; try { return await fn(); } finally { if (s === undefined) delete env.PARKING_MOCK_DATA; else env.PARKING_MOCK_DATA = s; } };

describe("목적지 검색(보유 주소 데이터)", () => {
  it("일치하는 주차장들의 중심(중앙값), 목업 원천은 제외", () => withMockOff(async () => {
    const r = await resolveDestination(await seed(), "역삼동");
    expect(r).toMatchObject({ lat: 37.502, lng: 127.038, region: "서울특별시 강남구", matches: 3, otherRegions: [] });
  }));
  it("여러 지역에 있으면 일치가 많은 지역을 고르고 다른 후보를 알려 줌, 지역명을 함께 넣으면 그 지역", () => withMockOff(async () => {
    const db = await seed();
    expect(await resolveDestination(db, "중앙로")).toMatchObject({ region: "경기도 수원시", matches: 2, otherRegions: ["대전광역시 중구"] });
    expect(await resolveDestination(db, "대전 중앙로")).toMatchObject({ region: "대전광역시 중구", matches: 1, otherRegions: [] });
  }));
  it("없는 말·너무 짧은 말은 찾지 못함, LIKE 특수문자는 글자 그대로", () => withMockOff(async () => {
    const db = await seed();
    expect(await resolveDestination(db, "없는동네")).toBeNull();
    expect(await resolveDestination(db, "역")).toBeNull();
    expect(await resolveDestination(db, "%%")).toBeNull();
    expect(await resolveDestination(db, "__")).toBeNull();
    expect((await resolveDestination(db, "100%_"))?.matches).toBe(1);
  }));
  it("검색 연결: 찾은 위치로 검색하고 대략 위치임을 응답에 표시, 못 찾으면 안내 오류", () => withMockOff(async () => {
    const db = await seed();
    const q = new URLSearchParams({ destination: "역삼동", startAt: "2026-11-16T10:00:00+09:00", endAt: "2026-11-16T11:00:00+09:00" });
    const p = parseSearchParams(q, await resolveDestination(db, "역삼동"));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const res = await searchLots(db, p.params, new Date("2026-11-12T00:00:00Z"));
    expect(res.searchCenter).toMatchObject({ kind: "destination", label: "역삼동", place: { region: "서울특별시 강남구", matches: 3 } });
    expect(res.items).toHaveLength(3);
    const miss = parseSearchParams(q, null);
    expect(miss.ok ? "" : miss.code).toBe("DESTINATION_NOT_FOUND");
  }));
});

const item = (id: number, dist: number, fee: Partial<LotItem["fee"]>, warn: string[] = []) => ({ id, name: `L${id}`, distanceMeters: dist, fee: { status: "OK", ...fee }, feeWarnings: warn }) as unknown as LotItem;
describe("한눈에 보기", () => {
  it("최저 요금(계산 불가·요금 이상 시설 제외), 가장 가까움, 가장 가까운 무료", () => {
    const p = pickHighlights([item(1, 100, { status: "UNKNOWN" }), item(2, 300, { amount: 1000, isFree: false }), item(3, 500, { amount: 0, isFree: true }), item(4, 200, { amount: 10, isFree: false }, ["HOURLY_TOO_HIGH"]), item(5, 900, { amount: 0, isFree: true })]);
    expect(p.cheapest).toMatchObject({ id: 3, amount: 0, isFree: true });
    expect(p.nearest).toMatchObject({ id: 1, amount: null });
    expect(p.nearestFree?.id).toBe(3);
  });
  it("후보가 2곳 미만이면 표시하지 않음, 요금 계산 가능한 곳이 없으면 최저 요금 없음", () => {
    expect(pickHighlights([item(1, 100, { amount: 0, isFree: true })])).toEqual({ cheapest: null, nearest: null, nearestFree: null });
    const p = pickHighlights([item(1, 100, { status: "UNKNOWN" }), item(2, 200, { status: "UNKNOWN" })]);
    expect(p.cheapest).toBeNull(); expect(p.nearestFree).toBeNull(); expect(p.nearest?.id).toBe(1);
  });
});

describe("도보 시간 추정", () => {
  it("직선거리 ×1.3 ÷ 분속 67m, 최소 1분", () => {
    expect(walkMinutesEstimate(0)).toBe(1);
    expect(walkMinutesEstimate(335)).toBe(7); // 435.5m ÷ 67 ≈ 6.5 → 7
    expect(walkMinutesEstimate(1000)).toBe(19);
  });
});
