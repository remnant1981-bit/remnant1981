// 정적 데모 빌드: 실서비스 원천만 담고, 목업은 넣지 않으며, 페이지가 데이터·엔진을 인라인으로 포함하는지
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSqliteDb, migrate } from "@/server/db";
import { runSync } from "@/collector/runner";
import { FixtureAdapter } from "@/collector/fixture-adapter";
import { STANDARD_SOURCE } from "@/collector/standard-api";
import { ensureMockData } from "@/server/mock";

describe("데모 빌드", () => {
  it("표준데이터 시설만 포함하고 목업은 제외", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-demo-"));
    const dbFile = path.join(dir, "t.sqlite"), out = path.join(dir, "demo.html");
    const db = await createSqliteDb(dbFile);
    await migrate(db);
    const r = await runSync(db, new FixtureAdapter(STANDARD_SOURCE, "tests/fixtures/standard-parking.sample.json"), new Date("2026-11-07T12:00:00+09:00"));
    await ensureMockData(db, new Date("2026-11-07T12:00:00+09:00"));
    const geo = (await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM parking_lots WHERE source_name=? AND latitude IS NOT NULL AND data_status NOT LIKE 'EXCLUDED%'", [STANDARD_SOURCE]))!.c;
    try { execFileSync(process.execPath, ["--import", "tsx", "scripts/demo/build.ts", "--db", dbFile, "--out", out], { stdio: "pipe" }); } catch (e) { throw new Error(String((e as { stderr?: Buffer }).stderr ?? e)); }
    const html = fs.readFileSync(out, "utf8");
    const json = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(r.inserted).toBeGreaterThan(0);
    expect(json.lots.length).toBe(geo);
    expect(html).toContain("var PS=");
    expect(html).not.toContain("/*DATA*/");
    expect(JSON.stringify(json.lots)).not.toContain("목업");
    expect(json.holidays).toBeNull(); // 공휴일 데이터가 없으면 넣지 않음(판정 불가로 표시)
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
