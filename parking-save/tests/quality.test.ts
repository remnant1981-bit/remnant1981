import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { FixtureAdapter } from "@/collector/fixture-adapter";
import { runSync } from "@/collector/runner";
import { HolidayApiError, syncHolidays } from "@/collector/holidays";
import { buildQualityReport } from "@/server/quality";
import type { RawRow, SourceAdapter } from "@/collector/types";

const FIX = path.resolve(import.meta.dirname, "fixtures/standard-parking.sample.json");
const rows = (JSON.parse(fs.readFileSync(FIX, "utf8")) as { rows: RawRow[] }).rows;
const NOW = new Date("2026-11-07T12:00:00+09:00");
const codes = (r: Awaited<ReturnType<typeof buildQualityReport>>) => r.alerts.map((a) => a.code);
const levelOf = (r: Awaited<ReturnType<typeof buildQualityReport>>, c: string) => r.alerts.find((a) => a.code === c)?.level;
const subset = (name: string, rs: RawRow[]): SourceAdapter => ({ sourceName: name, async *fetch() { for (const r of rs) yield r; } });

describe("데이터 품질 리포트", () => {
  let db: Db;
  beforeEach(async () => { db = await createSqliteDb(":memory:"); await migrate(db); });

  it("빈 DB: 오류 없이 비율은 null, 공휴일 커버리지 없음은 정보 수준", async () => {
    const r = await buildQualityReport(db, NOW);
    expect(r.totals.lots).toBe(0);
    expect(r.feeCalculation.calculableRatio).toBeNull();
    expect(levelOf(r, "HOLIDAY_COVERAGE_MISSING")).toBe("INFO");
    expect(r.alerts.some((a) => a.level === "ERROR")).toBe(false);
  });

  it("샘플 원천: 목업·샘플 표시, 품질 플래그·요금 계산 비율·중복 후보 집계", async () => {
    await runSync(db, new FixtureAdapter("STANDARD_SAMPLE", FIX), NOW);
    const r = await buildQualityReport(db, NOW);
    expect(r.sources[0]).toMatchObject({ source: "STANDARD_SAMPLE", isNonProduction: true, lots: 9, excluded: 0 });
    expect(codes(r)).toContain("NON_PRODUCTION_SOURCE");
    expect(codes(r)).not.toContain("SYNC_STALE"); // 샘플은 운영 경보 대상 아님
    expect(r.totals).toMatchObject({ lots: 9, withCoords: 8, ownershipUnknown: 1, typeUnknown: 1 });
    expect(r.flags.COORD_OUT_OF_RANGE).toBe(1);
    expect(r.flags.FEE_INCOMPLETE).toBe(1);
    expect(r.feeCalculation).toMatchObject({ calculable: 5, free: 2, unknown: 4 });
    expect(r.feeCalculation.unknownByReason).toMatchObject({ NO_RULES: 3, UNSUPPORTED_DAILY_MAX_BASIS: 1 });
    expect(r.duplicates.pending).toBeGreaterThanOrEqual(1);
    expect(codes(r)).toContain("DUPLICATES_PENDING");
  });

  it("운영 원천: 수집 중단(3일 초과)·좌표 불량률·공휴일 없음 경보", async () => {
    await runSync(db, new FixtureAdapter("REAL_LIKE", FIX), NOW);
    const later = new Date(NOW.getTime() + 5 * 86400_000);
    const r = await buildQualityReport(db, later);
    expect(levelOf(r, "SYNC_STALE")).toBe("ERROR");
    expect(codes(r)).toContain("COORD_QUALITY"); // 1/9 ≈ 11% > 5%
    expect(levelOf(r, "HOLIDAY_COVERAGE_MISSING")).toBe("WARN");
    expect(codes(r)).toContain("STALE_LOTS");
    const fresh = await buildQualityReport(db, NOW);
    expect(codes(fresh)).not.toContain("SYNC_STALE");
  });

  it("수집 건수 급감 경보", async () => {
    await runSync(db, subset("REAL_LIKE", rows), NOW);
    await runSync(db, subset("REAL_LIKE", rows.slice(0, 5)), new Date(NOW.getTime() + 3600_000));
    expect(codes(await buildQualityReport(db, new Date(NOW.getTime() + 7200_000)))).toContain("RECORDS_DROP");
  });

  it("마지막 수집 실패", async () => {
    await runSync(db, subset("REAL_LIKE", rows), NOW);
    await runSync(db, { sourceName: "REAL_LIKE", async *fetch() { throw new Error("boom"); } }, new Date(NOW.getTime() + 3600_000));
    const r = await buildQualityReport(db, new Date(NOW.getTime() + 7200_000));
    expect(levelOf(r, "SYNC_FAILED")).toBe("ERROR");
  });

  it("공휴일 인증 실패·호출 제한 경보, 커버리지 만료 경보", async () => {
    await syncHolidays(db, async () => { throw new HolidayApiError("30", "x"); }, NOW);
    await syncHolidays(db, async () => { throw new HolidayApiError("22", "x"); }, new Date(NOW.getTime() + 60_000));
    const r = await buildQualityReport(db, NOW);
    expect(codes(r)).toEqual(expect.arrayContaining(["AUTH_FAILURE", "QUOTA_EXCEEDED"]));

    const ok = async (y: number, m: number) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: m === 1 || m === 12 ? { item: [{ locdate: Number(`${y}${m === 1 ? "0101" : "1225"}`), isHoliday: "Y", dateName: "x", dateKind: "01", seq: 1 }] } : "", totalCount: m === 1 || m === 12 ? 1 : 0 } } });
    await syncHolidays(db, ok, NOW);
    const expired = await buildQualityReport(db, new Date(NOW.getTime() + 10 * 86400_000));
    expect(levelOf(expired, "HOLIDAY_COVERAGE_EXPIRED")).toBe("ERROR");
    const fresh = await buildQualityReport(db, new Date(NOW.getTime() + 86400_000));
    expect(codes(fresh)).not.toContain("HOLIDAY_COVERAGE_EXPIRED");
    expect(fresh.holidays.coverage[0].source).toBe("KASI_SPCDE");
  });

  it("리포트에 사용자 위치·비밀값 없음", async () => {
    await runSync(db, new FixtureAdapter("STANDARD_SAMPLE", FIX), NOW);
    expect(JSON.stringify(await buildQualityReport(db, NOW))).not.toMatch(/serviceKey|SERVICE_KEY|password/i);
  });
});
