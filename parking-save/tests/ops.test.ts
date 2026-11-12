import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log, logError, recentErrorCount, redact, setLogSink } from "@/server/log";
import { createSqliteDb, migrate } from "@/server/db";
import { deepCheck, deepCheckOk, schemaState } from "@/server/db-check";

describe("구조화 로그", () => {
  it("한 줄 JSON, 좌표·토큰·인증키·검색어는 남기지 않음", () => {
    const lines: string[] = [];
    const prev = setLogSink((l) => lines.push(l));
    try {
      log("info", "search", { lat: 37.5663, lng: 126.9779, destination: "서울시청", sort: "price_asc", ms: 12 }, Date.parse("2026-11-12T00:00:00Z"));
      logError("sync.fatal", new Error("GET https://apis.data.go.kr/x?serviceKey=abcDEF123%2B&pageNo=1 failed; Authorization: Bearer tok_123 at 37.5663, 126.9779"));
    } finally { setLogSink(prev); }
    const a = JSON.parse(lines[0]);
    expect(a).toMatchObject({ ts: "2026-11-12T00:00:00.000Z", level: "info", event: "search", lat: "[REDACTED]", lng: "[REDACTED]", destination: "[REDACTED]", sort: "price_asc", ms: 12 });
    const b = JSON.parse(lines[1]);
    expect(b.level).toBe("error");
    expect(b.error).not.toMatch(/abcDEF123|tok_123|37\.5663/);
    expect(b.error).toMatch(/serviceKey=\[REDACTED\]/);
    expect(b.error).toMatch(/\[COORD\]/);
  });

  it("최근 5분 오류 수 집계(헬스체크용)", () => {
    const prev = setLogSink(() => {});
    try {
      const base = recentErrorCount();
      const now = Date.now();
      log("error", "x", {}, now); log("error", "x", {}, now); log("warn", "y", {}, now);
      expect(recentErrorCount(now) - base).toBe(2);
      expect(recentErrorCount(now + 6 * 60_000)).toBe(0); // 5분 지나면 빠짐
    } finally { setLogSink(prev); }
  });

  it("redact: 길이 제한·일반 문장은 그대로", () => {
    expect(redact("평범한 메시지 123")).toBe("평범한 메시지 123");
    expect(redact("x".repeat(5000))).toHaveLength(2000);
    expect(redact('{"token":"s3cr3t","password": "pw"}')).not.toMatch(/s3cr3t|"pw"/);
  });
});

describe("DB 점검", () => {
  it("정상 DB: 무결성 ok·외래키 위반 0·마이그레이션 누락 없음", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const r = await deepCheck(db);
    expect(r.integrity).toEqual(["ok"]);
    expect(r.foreignKeyViolations).toBe(0);
    expect(r.schema.missing).toEqual([]);
    expect(deepCheckOk(r)).toBe(true);
  });

  it("앱 이미지에 새 마이그레이션이 있는데 DB에 적용 안 됐으면 누락으로 보고", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of fs.readdirSync("migrations")) fs.copyFileSync(path.join("migrations", f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, "9999_future.sql"), "SELECT 1;");
    const s = await schemaState(db, dir);
    expect(s.missing).toEqual(["9999_future.sql"]);
    expect(deepCheckOk(await deepCheck(db, dir))).toBe(false);
  });

  it("외래키가 깨진 행을 찾아냄", async () => {
    const db = await createSqliteDb(":memory:"); await migrate(db);
    await db.exec("PRAGMA foreign_keys = OFF");
    await db.run("INSERT INTO fee_rules(parking_lot_id, rule_type, valid_day_type) VALUES (424242, 'FREE', 'EVERYDAY')");
    const r = await deepCheck(db);
    expect(r.foreignKeyViolations).toBeGreaterThan(0);
    expect(deepCheckOk(r)).toBe(false);
  });
});
