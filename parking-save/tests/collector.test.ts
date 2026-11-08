import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { FixtureAdapter } from "@/collector/fixture-adapter";
import { runSync } from "@/collector/runner";
import { normalizeStandardRow } from "@/collector/standard-parking";
import { findCandidates } from "@/collector/dedupe";
import { parseSearchParams, searchLots } from "@/server/search";
import type { RawRow, SourceAdapter } from "@/collector/types";

const FIX = path.resolve(import.meta.dirname, "fixtures/standard-parking.sample.json");
const rows = (JSON.parse(fs.readFileSync(FIX, "utf8")) as { rows: RawRow[] }).rows;
const byId = (id: string) => rows.find((r) => r["주차장관리번호"] === id)!;
const ok = (id: string) => { const r = normalizeStandardRow(byId(id)); if (r.kind !== "ok") throw new Error(id + " " + r.kind); return r.lot; };

describe("정규화", () => {
  it("공식 샘플 무료 행: 공영·노외·좌표·면수·기준일, 무료 규칙", () => {
    const l = ok("156-2-000050");
    expect(l).toMatchObject({ ownershipType: "PUBLIC", parkingType: "OFF_STREET", totalSpaces: 42, latitude: 35.83224429, operatorName: "대구광역시 달서구청" });
    expect(l.sourceUpdatedAt).toBe("2026-10-05T15:00:00.000Z"); // 2026-10-06 00:00 KST
    expect(l.feeRules).toEqual([{ ruleType: "FREE", amount: null, durationMinutes: null, dayType: "EVERYDAY", dailyMaxBasis: null }]);
    expect(l.schedules.map((s) => [s.dayType, s.allDay])).toEqual([["WEEKDAY", true], ["SATURDAY", true], ["HOLIDAY", true], ["SUNDAY", true]]);
    // 일요일은 원천에 항목이 없어 공휴일 규칙을 적용(사용자 결정 2026-11-08) — 추정으로 표시
    expect(l.schedules.find((s) => s.dayType === "SUNDAY")).toMatchObject({ assumed: true, openTime: "00:00", closeTime: "23:59" });
    expect(l.schedules.filter((s) => s.assumed)).toHaveLength(1);
    expect(l.qualityFlags).toContain("SUNDAY_ASSUMED_HOLIDAY_RULE");
  });
  it("유료: 기본+추가 규칙, 06~22시 일정은 종일 아님", () => {
    const l = ok("SYN-1");
    expect(l.feeRules.map((r) => [r.ruleType, r.amount, r.durationMinutes])).toEqual([["BASE", 1000, 30], ["ADDITIONAL", 500, 15]]);
    expect(l.schedules[0]).toMatchObject({ openTime: "06:00", closeTime: "22:00", allDay: false });
  });
  it("민영·부설은 범위 제외, 관리번호/이름 없음은 invalid", () => {
    expect(normalizeStandardRow(byId("SYN-2"))).toEqual({ kind: "excluded", reason: "PRIVATE" });
    expect(normalizeStandardRow(byId("SYN-3"))).toEqual({ kind: "excluded", reason: "ATTACHED_OR_OTHER_TYPE" });
    expect(normalizeStandardRow(rows.find((r) => !r["주차장관리번호"])!)).toEqual({ kind: "invalid", reason: "MISSING_KEY" });
  });
  it("좌표 뒤바뀜 → 좌표 사용 안 함, 기본요금 없음 → 규칙 미생성(0원 아님)", () => {
    const l = ok("SYN-4");
    expect(l.latitude).toBeNull(); expect(l.longitude).toBeNull();
    expect(l.qualityFlags).toContain("COORD_OUT_OF_RANGE");
    expect(l.feeRules).toEqual([]); expect(l.qualityFlags).toContain("FEE_INCOMPLETE");
  });
  it("구분·유형 미기재는 공영 단정 금지, 면수·기준일 불량은 NULL", () => {
    const l = ok("SYN-5");
    expect(l.ownershipType).toBe("UNKNOWN"); expect(l.parkingType).toBe("UNKNOWN");
    expect(l.totalSpaces).toBeNull(); expect(l.sourceUpdatedAt).toBeNull();
    expect(l.qualityFlags).toEqual(expect.arrayContaining(["OWNERSHIP_UNVERIFIED", "TYPE_UNKNOWN", "SPACES_INVALID", "SOURCE_DATE_MISSING"]));
    expect(l.feeRules.find((r) => r.ruleType === "DAILY_MAX")).toMatchObject({ amount: 5000, dailyMaxBasis: "UNKNOWN" });
    expect(l.schedules).toEqual([]); // 운영요일 미기재 → 24시간 아님
  });
  it("무료인데 요금 기재 → 충돌, 혼합 → 요금 미확인", () => {
    expect(ok("SYN-8").feeRules).toEqual([]); expect(ok("SYN-8").qualityFlags).toContain("FEE_CONFLICT");
    expect(ok("SYN-9").feeRules).toEqual([]); expect(ok("SYN-9").qualityFlags).toContain("FEE_KIND_UNSUPPORTED");
  });
});

describe("중복 후보", () => {
  it("동일 시설명·근접 → 후보, 멀면 아님, 자동 병합 없음", () => {
    const a = { id: 1, name: "송현 공영주차장", roadAddress: "A로 1", latitude: 35.83, longitude: 128.55 };
    expect(findCandidates(a, { ...a, id: 2, latitude: 35.83015 })).toMatchObject({ lotA: 1, lotB: 2 });
    expect(findCandidates(a, { ...a, id: 2, latitude: 35.9 })).toBeNull();
    expect(findCandidates(a, { id: 3, name: "전혀 다른 곳", roadAddress: "B로 9", latitude: 35.8312, longitude: 128.55 })).toBeNull();
  });
});

describe("동기화 실행", () => {
  let db: Db;
  beforeEach(async () => { db = await createSqliteDb(":memory:"); await migrate(db); });
  const adapter = () => new FixtureAdapter("STANDARD_SAMPLE", FIX);
  const count = async (sql: string) => (await db.get<{ c: number }>(sql))!.c;

  it("수집 → 원천 보존 → 저장 → 로그", async () => {
    const s = await runSync(db, adapter());
    expect(s).toMatchObject({ received: 12, inserted: 9, excluded: 2, invalid: 1, errors: 0, status: "PARTIAL" });
    expect(await count("SELECT COUNT(*) c FROM source_raw_records")).toBe(9);
    expect(await count("SELECT COUNT(*) c FROM parking_lots")).toBe(9);
    const log = await db.get<{ status: string; records_received: number; source_data_timestamp: string | null }>("SELECT * FROM source_sync_logs");
    expect(log).toMatchObject({ status: "PARTIAL", records_received: 12 });
    expect(log?.source_data_timestamp).toBe("2026-10-05T15:00:00.000Z");
    // 원천 원문 보존: 정규화 전 원본 값 그대로
    const raw = await db.get<{ payload_json: string }>("SELECT payload_json FROM source_raw_records WHERE source_record_id='156-2-000050'");
    expect(JSON.parse(raw!.payload_json)["요금정보"]).toBe("무료");
  });
  it("재실행은 멱등(변경 없음), 변경 시 갱신·규칙 교체·원문 이력 추가", async () => {
    await runSync(db, adapter());
    const again = await runSync(db, adapter());
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 9 });
    expect(await count("SELECT COUNT(*) c FROM fee_rules WHERE parking_lot_id=(SELECT id FROM parking_lots WHERE source_record_id='SYN-1')")).toBe(2);

    const changed = rows.map((r) => (r["주차장관리번호"] === "SYN-1" ? { ...r, 주차기본요금: "1500" } : r));
    const a: SourceAdapter = { sourceName: "STANDARD_SAMPLE", async *fetch() { for (const r of changed) yield r; } };
    const s3 = await runSync(db, a);
    expect(s3).toMatchObject({ updated: 1, unchanged: 8 });
    expect((await db.get<{ amount: number }>("SELECT amount FROM fee_rules WHERE rule_type='BASE' AND source_record_id='SYN-1'"))?.amount).toBe(1500);
    expect(await count("SELECT COUNT(*) c FROM source_raw_records WHERE source_record_id='SYN-1'")).toBe(2);
  });
  it("중복 후보는 기록만 하고 레코드는 둘 다 보존", async () => {
    const s = await runSync(db, adapter());
    expect(s.duplicateCandidates).toBeGreaterThanOrEqual(1);
    const c = await db.get<{ status: string; reason: string }>("SELECT * FROM duplicate_candidates");
    expect(c?.status).toBe("PENDING");
    expect(await count("SELECT COUNT(*) c FROM parking_lots WHERE source_record_id IN ('SYN-1','SYN-6')")).toBe(2);
  });
  it("행 오류가 전체를 중단하지 않음 / 원천 장애는 FAILED 기록", async () => {
    const boom: SourceAdapter = { sourceName: "X", async *fetch() { yield rows[0]; throw new Error("upstream 500 secret-token"); } };
    const s = await runSync(db, boom);
    expect(s.status).toBe("FAILED"); expect(s.inserted).toBe(1);
    const log = await db.get<{ error_summary: string }>("SELECT error_summary FROM source_sync_logs");
    expect(log?.error_summary).not.toContain("secret-token"); // 로그 요약에 내부 오류 상세 미포함
  });
  it("범위 제외로 바뀐 기존 시설은 검색에서 빠짐", async () => {
    await runSync(db, adapter());
    const flipped = rows.map((r) => (r["주차장관리번호"] === "SYN-1" ? { ...r, 주차장구분: "민영" } : r));
    await runSync(db, { sourceName: "STANDARD_SAMPLE", async *fetch() { for (const r of flipped) yield r; } });
    const r = parseSearchParams(new URLSearchParams({ lat: "35.83", lng: "128.55", radiusMeters: "2000", startAt: "2026-11-09T10:00:00+09:00", endAt: "2026-11-09T11:00:00+09:00" }));
    if (!r.ok) throw new Error();
    const res = await searchLots(db, r.params, new Date("2026-11-09T10:00:00+09:00"));
    const syn1 = (await db.get<{ id: number; data_status: string }>("SELECT id, data_status FROM parking_lots WHERE source_record_id='SYN-1'"))!;
    expect(syn1.data_status).toBe("EXCLUDED_SCOPE");
    expect(res.items.some((i) => i.id === syn1.id)).toBe(false);
    expect(res.items.some((i) => i.name.includes("송현2동"))).toBe(true); // 다른 시설은 유지
  });
});

describe("수집 데이터 검색·요금 연동", () => {
  it("요금 계산 가능/불가가 규칙 품질대로 노출, 샘플 출처 표시", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    await runSync(db, new FixtureAdapter("STANDARD_SAMPLE", FIX));
    const r = parseSearchParams(new URLSearchParams({ lat: "35.832", lng: "128.552", radiusMeters: "2000", startAt: "2026-11-09T10:00:00+09:00", endAt: "2026-11-09T11:00:00+09:00" }));
    if (!r.ok) throw new Error();
    const res = await searchLots(db, r.params, new Date("2026-11-09T09:00:00+09:00"));
    const get = (n: string) => res.items.find((i) => i.name.includes(n))!;
    expect(get("송현2동").fee).toMatchObject({ status: "OK", isFree: true });
    expect(get("송현2동").occupancy.status).toBe("UNAVAILABLE");
    // 평일 규칙(요일 구분 없는 EVERYDAY 요금) → 공휴일 데이터 없이도 계산: 1시간 = 1000 + 2*500
    expect(get("달서 유료").fee).toMatchObject({ status: "OK", amount: 2000 });
    expect(get("정기권 병기").fee).toMatchObject({ status: "OK", amount: 1500 }); // 정기권이 병기돼도 시간제 계산을 막지 않음 (60분 = 기본 1500)
    expect(get("1일권").fee).toMatchObject({ status: "UNKNOWN", reason: "UNSUPPORTED_DAILY_MAX_BASIS" });
    expect(get("무료인데").fee).toMatchObject({ status: "UNKNOWN", reason: "NO_RULES" });
    expect(get("1일권").ownershipType).toBe("UNKNOWN");
    expect(res.items.every((i) => i.isMock)).toBe(true);
    expect(res.dataCoverage.excludedNoCoordinates).toBe(1); // 좌표 불량 시설은 검색 제외로 집계
    expect(res.items.some((i) => i.name.includes("좌표 뒤바뀜"))).toBe(false);
  });
});

describe("일요일 = 공휴일 규칙 적용(추정)", () => {
  it("공휴일 항목이 없으면 일요일 일정도 만들지 않음 (운영요일에 공휴일 미포함)", () => {
    const r = normalizeStandardRow({ ...byId("SYN-1"), 운영요일: "평일+토요일" });
    if (r.kind !== "ok") throw new Error();
    expect(r.lot.schedules.map((s) => s.dayType)).toEqual(["WEEKDAY", "SATURDAY"]);
    expect(r.lot.qualityFlags).not.toContain("SUNDAY_ASSUMED_HOLIDAY_RULE");
  });
  it("운영요일에 '일요일'이 명시되면 임의 복사하지 않음", () => {
    const r = normalizeStandardRow({ ...byId("SYN-1"), 운영요일: "평일+일요일+공휴일" });
    if (r.kind !== "ok") throw new Error();
    expect(r.lot.schedules.some((s) => s.dayType === "SUNDAY")).toBe(false);
  });
  it("검색: 일요일 운영 판정 + 추정 표시, 평일에는 추정 아님, 추정 유의점 노출", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    await runSync(db, new FixtureAdapter("STANDARD_SAMPLE", FIX));
    // 공휴일 판정이 가능해야 요일별 일정을 쓴다(커버리지 없으면 확인 불가가 정상)
    await db.run("INSERT INTO holiday_coverage(source_name, from_date, to_date, collected_at) VALUES ('T','2026-01-01','2026-12-31','2026-11-06T00:00:00Z')");
    const search = async (start: string, end: string) => {
      const r = parseSearchParams(new URLSearchParams({ lat: "35.83", lng: "128.55", radiusMeters: "2000", startAt: start, endAt: end }));
      if (!r.ok) throw new Error(r.code);
      return searchLots(db, r.params, new Date("2026-11-06T09:00:00+09:00"));
    };
    // 2026-11-08은 일요일. SYN-1은 06~22시 운영
    const sun = await search("2026-11-08T10:00:00+09:00", "2026-11-08T11:00:00+09:00");
    const lot = sun.items.find((i) => i.name.includes("달서 유료"))!;
    expect(lot.operating).toBe("OPERATING");
    expect(lot.operatingAssumed).toBe(true);
    expect(lot.explanation.cautions.join()).toContain("추정");
    const sunLate = await search("2026-11-08T23:00:00+09:00", "2026-11-08T23:30:00+09:00");
    expect(sunLate.items.find((i) => i.name.includes("달서 유료"))!.operating).toBe("OUTSIDE");
    const mon = await search("2026-11-09T10:00:00+09:00", "2026-11-09T11:00:00+09:00");
    const monLot = mon.items.find((i) => i.name.includes("달서 유료"))!;
    expect(monLot.operating).toBe("OPERATING");
    expect(monLot.operatingAssumed).toBe(false);
    // 운영요일 미기재 시설은 여전히 확인 불가(추정 안 함)
    expect(sun.items.find((i) => i.name.includes("구분·유형 미기재"))!.operating).toBe("UNKNOWN");
  });
});
