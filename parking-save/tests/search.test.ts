import { beforeAll, describe, expect, it } from "vitest";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { ensureMockData } from "@/server/mock";
import { parseSearchParams, searchLots, getLotDetail, type SearchResponse } from "@/server/search";

const NOW = new Date("2026-11-09T10:00:00+09:00"); // 월요일
let db: Db;
beforeAll(async () => {
  db = await createSqliteDb(":memory:");
  await migrate(db);
  await ensureMockData(db, NOW);
});

const q = (o: Record<string, string>) => {
  const r = parseSearchParams(new URLSearchParams({ destination: "서울시청", startAt: "2026-11-09T10:00:00+09:00", endAt: "2026-11-09T11:00:00+09:00", ...o }));
  if (!r.ok) throw new Error(r.code);
  return r.params;
};
const run = (o: Record<string, string> = {}): Promise<SearchResponse> => searchLots(db, q(o), NOW);
const byName = (r: SearchResponse, part: string) => r.items.find((i) => i.name.includes(part))!;

describe("입력 검증", () => {
  const code = (o: Record<string, string>) => { const r = parseSearchParams(new URLSearchParams(o)); return r.ok ? "OK" : r.code; };
  const base = { destination: "서울시청", startAt: "2026-11-09T10:00:00+09:00", endAt: "2026-11-09T11:00:00+09:00" };
  it("위치/목적지 없음", () => expect(code({ startAt: base.startAt, endAt: base.endAt })).toBe("MISSING_CENTER"));
  it("알 수 없는 목적지", () => expect(code({ ...base, destination: "없는곳" })).toBe("DESTINATION_NOT_FOUND"));
  it("좌표 오류", () => { expect(code({ ...base, lat: "95", lng: "127" })).toBe("INVALID_COORDINATES"); expect(code({ ...base, lat: "37.5" })).toBe("INVALID_COORDINATES"); });
  it("오프셋 없는 시각 거부", () => expect(code({ ...base, startAt: "2026-11-09T10:00" })).toBe("INVALID_PERIOD"));
  it("종료 ≤ 시작", () => expect(code({ ...base, endAt: base.startAt })).toBe("INVALID_PERIOD"));
  it("반경/정렬/유형 범위", () => {
    expect(code({ ...base, radiusMeters: "99999" })).toBe("INVALID_RADIUS");
    expect(code({ ...base, sort: "x" })).toBe("INVALID_SORT");
    expect(code({ ...base, type: "x" })).toBe("INVALID_TYPE");
  });
  it("기간 상한", () => expect(code({ ...base, endAt: "2026-12-30T11:00:00+09:00" })).toBe("PERIOD_TOO_LONG"));
});

describe("검색 결과 상태 구분", () => {
  it("반경 필터", async () => {
    const r1 = await run();
    expect(r1.items.some((i) => i.name.includes("서울역"))).toBe(false);
    const r3 = await run({ radiusMeters: "3000" });
    expect(r3.items.some((i) => i.name.includes("서울역"))).toBe(true);
  });
  it("무료 시설: 규칙 근거로 무료, 운영 중", async () => {
    const i = byName(await run(), "무료개방");
    expect(i.fee).toMatchObject({ status: "OK", amount: 0, isFree: true });
    expect(i.operating).toBe("OPERATING");
  });
  it("요금 규칙 없음 ≠ 무료, 면수 NULL 유지, 운영 확인 불가", async () => {
    const i = byName(await run(), "서소문");
    expect(i.fee).toMatchObject({ status: "UNKNOWN", reason: "NO_RULES" });
    expect(i.fee.amount).toBeUndefined();
    expect(i.totalSpaces).toBeNull();
    expect(i.operating).toBe("UNKNOWN");
    expect(i.occupancy.status).toBe("UNAVAILABLE");
  });
  it("요금 계산 값", async () => expect(byName(await run(), "시청앞").fee.amount).toBe(2000));
  it("실시간: 유효/오래됨/미제공 구분", async () => {
    const r = await run();
    expect(byName(r, "시청앞").occupancy).toMatchObject({ status: "AVAILABLE", availableSpaces: 45 });
    expect(byName(r, "남대문").occupancy).toEqual({ status: "UNAVAILABLE", reason: "STALE" });
    expect(byName(r, "덕수궁길").occupancy).toEqual({ status: "UNAVAILABLE", reason: "NO_DATA" });
  });
  it("혼잡: 잔여 3/600", async () => {
    const i = byName(await run({ radiusMeters: "3000" }), "서울역");
    expect(i.occupancy).toMatchObject({ status: "AVAILABLE", congestion: "BUSY" });
  });
  it("규칙 불명확 → 계산 불가", async () => expect(byName(await run(), "광화문").fee).toMatchObject({ status: "UNKNOWN", reason: "RULE_DAYTYPE_UNKNOWN" }));
  it("운영시간 미기재 시설도 24시간으로 간주하지 않음", async () => expect(byName(await run(), "을지로").operating).toBe("UNKNOWN"));
  it("공영 미확인 경고 + 목업 경고", async () => {
    const r = await run();
    expect(r.warnings.some((w) => w.startsWith("OWNERSHIP_UNVERIFIED"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("MOCK_DATA"))).toBe(true);
    expect(r.items.every((i) => i.isMock)).toBe(true);
  });
  it("운영 외 시간대 표시(무료 시설 23시 입차)", async () => {
    const r = await run({ startAt: "2026-11-09T23:00:00+09:00", endAt: "2026-11-09T23:30:00+09:00" });
    expect(byName(r, "무료개방").operating).toBe("OUTSIDE");
  });
});

describe("공휴일·요일 규칙", () => {
  it("범위 밖 기간: 공휴일 판정 불가 → 요일별 규칙 시설 계산 불가, 매일 규칙은 계산", async () => {
    const r = await run({ startAt: "2027-03-02T10:00:00+09:00", endAt: "2027-03-02T11:00:00+09:00" });
    expect(r.dataCoverage.holidayDataAvailable).toBe(false);
    expect(byName(r, "덕수궁길").fee).toMatchObject({ status: "UNKNOWN", reason: "HOLIDAY_DATA_MISSING" });
    expect(byName(r, "시청앞").fee.status).toBe("OK");
    expect(r.warnings.some((w) => w.startsWith("HOLIDAY_DATA_MISSING"))).toBe(true);
  });
  it("평일 낮 유료 / 평일 밤·일요일·공휴일 무료", async () => {
    expect(byName(await run(), "덕수궁길").fee).toMatchObject({ status: "OK", isFree: false });
    const night = await run({ startAt: "2026-11-09T21:00:00+09:00", endAt: "2026-11-09T22:00:00+09:00" });
    expect(byName(night, "덕수궁길").fee).toMatchObject({ status: "OK", isFree: true });
    const sun = await run({ startAt: "2026-11-08T10:00:00+09:00", endAt: "2026-11-08T12:00:00+09:00" });
    expect(byName(sun, "덕수궁길").fee).toMatchObject({ status: "OK", isFree: true });
    const xmas = await run({ startAt: "2026-12-25T10:00:00+09:00", endAt: "2026-12-25T12:00:00+09:00" });
    expect(byName(xmas, "덕수궁길").fee).toMatchObject({ status: "OK", isFree: true });
  });
});

describe("필터·정렬", () => {
  it("무료만", async () => {
    const r = await run({ freeOnly: "true" });
    expect(r.items.map((i) => i.name)).toEqual(["[목업] 청계천 무료개방 주차장"]);
  });
  it("실시간 확인 가능만", async () => {
    const r = await run({ realtimeOnly: "true", radiusMeters: "3000" });
    expect(r.items.every((i) => i.occupancy.status === "AVAILABLE")).toBe(true);
    expect(r.items.length).toBe(2);
  });
  it("노상/노외 필터 (UNKNOWN은 개별 필터에서 제외)", async () => {
    expect((await run({ type: "on_street" })).items.map((i) => i.parkingType)).toEqual(["ON_STREET"]);
    const off = await run({ type: "off_street" });
    expect(off.items.every((i) => i.parkingType === "OFF_STREET")).toBe(true);
    expect((await run({ type: "all" })).items.some((i) => i.parkingType === "UNKNOWN")).toBe(true);
  });
  it("무료 우선: 무료 → 요금 오름차순 → 계산불가는 뒤", async () => {
    const r = await run();
    expect(r.items[0].fee.isFree).toBe(true);
    const states = r.items.map((i) => i.fee.status);
    expect(states.lastIndexOf("OK")).toBeLessThan(states.indexOf("UNKNOWN"));
    const amounts = r.items.filter((i) => i.fee.status === "OK").map((i) => i.fee.amount!);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });
  it("요금순: 계산불가는 순위에 포함하지 않고 뒤", async () => {
    const r = await run({ sort: "price_asc" });
    const states = r.items.map((i) => i.fee.status);
    expect(states.lastIndexOf("OK")).toBeLessThan(states.indexOf("UNKNOWN"));
  });
  it("거리순", async () => {
    const d = (await run({ sort: "distance_asc" })).items.map((i) => i.distanceMeters);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
  it("잔여면수순: 유효 데이터만 앞, 미제공은 감점이 아니라 뒤에 거리순", async () => {
    const r = await run({ sort: "availability_desc", radiusMeters: "3000" });
    const avail = r.items.map((i) => (i.occupancy.status === "AVAILABLE" ? i.occupancy.availableSpaces : null));
    expect(avail.slice(0, 2)).toEqual([45, 3]);
    expect(avail.slice(2).every((a) => a === null)).toBe(true);
  });
  it("빈 결과", async () => {
    const r = await searchLots(db, { ...q({}), center: { lat: 35.1, lng: 129.0 }, centerLabel: "현재 위치", centerKind: "current_location" }, NOW);
    expect(r.items).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith("EMPTY"))).toBe(true);
  });
});

describe("상세", () => {
  it("규칙·출처 반환, 기간 지정 시 요금", async () => {
    const d = await getLotDetail(db, 1, { startAt: new Date("2026-11-09T10:00:00+09:00"), endAt: new Date("2026-11-09T10:30:00+09:00") }, NOW);
    expect(d?.feeRules.length).toBeGreaterThan(0);
    expect(d?.source.name).toBe("MOCK");
    expect(d?.fee).toMatchObject({ status: "OK", amount: 1000 });
  });
  it("없는 ID", async () => expect(await getLotDetail(db, 9999, null, NOW)).toBeNull());
});
