import { describe, expect, it } from "vitest";
import { createSqliteDb, migrate } from "@/server/db";

describe("migration", () => {
  it("스키마 적용 및 NULL 보존 (요금 미확인 ≠ 0)", async () => {
    const db = await createSqliteDb(":memory:");
    expect((await migrate(db)).length).toBe(2);
    const now = "2026-11-09T00:00:00Z";
    await db.run("INSERT INTO parking_lots(source_name, source_record_id, name, collected_at, created_at, updated_at) VALUES ('t','1','테스트',?,?,?)", [now, now, now]);
    await db.run("INSERT INTO fee_rules(parking_lot_id, rule_type) VALUES (1,'BASE')");
    const lot = await db.get<{ total_spaces: number | null; parking_type: string; ownership_type: string }>("SELECT * FROM parking_lots WHERE id=1");
    expect(lot?.total_spaces).toBeNull();
    expect(lot?.parking_type).toBe("UNKNOWN");
    expect(lot?.ownership_type).toBe("UNKNOWN");
    expect((await db.get<{ amount: number | null }>("SELECT amount FROM fee_rules"))?.amount).toBeNull();
  });
  it("잘못된 유형 거부", async () => {
    const db = await createSqliteDb(":memory:");
    await migrate(db);
    await expect(db.run("INSERT INTO parking_lots(source_name, source_record_id, name, parking_type, collected_at, created_at, updated_at) VALUES ('t','1','x','BAD','a','a','a')")).rejects.toThrow();
  });
});
