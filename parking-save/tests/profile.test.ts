import { describe, expect, it } from "vitest";
import path from "node:path";
import { createSqliteDb, migrate } from "@/server/db";
import { FixtureAdapter } from "@/collector/fixture-adapter";
import { runSync } from "@/collector/runner";
import { profileStandardSource } from "@/server/profile";

describe("원천 값 분포 점검", () => {
  it("샘플 픽스처의 분포·결측·좌표·시각 형식 요약", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    await runSync(db, new FixtureAdapter("STANDARD_SAMPLE", path.resolve(import.meta.dirname, "fixtures/standard-parking.sample.json")));
    const p = await profileStandardSource(db, "STANDARD_SAMPLE");
    expect(p.rawRecords).toBe(9);
    expect(p.categorical["주차장구분"].find((x) => x.value === "공영")!.count).toBe(8);
    expect(p.categorical["주차장구분"].some((x) => x.value === "(미기재)")).toBe(true);
    expect(p.categorical["요금정보"].map((x) => x.value)).toEqual(expect.arrayContaining(["무료", "유료", "혼합"]));
    expect(p.coordinates).toMatchObject({ total: 9, missing: 0, outOfKorea: 1 }); // 좌표 뒤바뀜 행
    expect(p.numeric["주차구획수"]).toMatchObject({ min: 5, max: 100, nonNumeric: 1 }); // "약30"
    expect(p.timeFormats["HH:MM"]).toBeGreaterThan(0);
    expect(p.blankRate["위도"]).toBe(0);
  });
  it("원천이 비어 있으면 0건·빈 분포", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const p = await profileStandardSource(db, "NONE");
    expect(p.rawRecords).toBe(0); expect(p.blankRate["위도"]).toBe(0);
  });
});
