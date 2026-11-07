import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createSqliteDb, migrate } from "@/server/db";
import { seedAll } from "@/server/bootstrap";
import { evaluateMatch, type CompanyProfile, type Rule } from "@/domain/matching";
import { freshDb } from "./helpers";
import { loadRules } from "@/server/recommend";

describe("백업·복구", () => {
  it("백업 후 복구하면 데이터가 동일하고 무결성 검사를 통과한다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbf-"));
    const dbFile = path.join(dir, "a.sqlite");
    const db = await createSqliteDb(dbFile);
    await migrate(db);
    await seedAll(db);
    const n = (await db.get<{ n: number }>("SELECT COUNT(*) n FROM announcements"))!.n;
    const env = { ...process.env, DATABASE_PATH: dbFile };
    const bak = path.join(dir, "bak.sqlite");
    execFileSync("npx", ["tsx", "scripts/backup.ts", "backup", bak], { env, stdio: "pipe" });
    await db.run("DELETE FROM announcements");
    execFileSync("npx", ["tsx", "scripts/backup.ts", "restore", bak], { env, stdio: "pipe" });
    const restored = await createSqliteDb(dbFile);
    expect((await restored.get<{ n: number }>("SELECT COUNT(*) n FROM announcements"))!.n).toBe(n);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60000);
});

// 가상 샘플 기업(실제 개인정보 아님)으로 시드 공고 판정 검증
const SAMPLES: { name: string; c: CompanyProfile; expect: Record<string, string> }[] = [
  { name: "경기 제조 연구소 보유", c: { region_sido: "경기도", region_sigungu: "시흥시", industry_name: "금속 제조업", established_at: "2018-03-01", employee_count_band: "10~49명", research_institute_status: "yes", venture_status: "no", export_status: "no", business_status: "계속사업자" },
    expect: { "기술개발(R&D)": "likely_met", "경기도 중소기업": "likely_met", "시흥시": "likely_met", "서울시": "likely_not_met", "벤처기업": "likely_not_met", "수출 초보": "likely_met", "스마트설비": "likely_met" } },
  { name: "서울 신생 벤처", c: { region_sido: "서울특별시", established_at: "2025-06-01", venture_status: "yes", employee_count_band: "5명 미만" },
    expect: { "서울시": "likely_met", "경기도 중소기업": "likely_not_met", "청년 창업": "likely_met", "벤처기업": "likely_met", "기술개발(R&D)": "needs_check" } },
  { name: "정보 미입력", c: {}, expect: { "기술개발(R&D)": "needs_check", "서울시": "needs_check", "벤처기업": "needs_check" } },
  { name: "폐업자 + 수출 실적 있음", c: { business_status: "폐업자", export_status: "yes", region_sido: "경기도" }, expect: { "기술개발(R&D)": "likely_not_met", "수출 초보": "likely_not_met" } },
];

describe("샘플 기업 검증(가상 데이터)", () => {
  for (const s of SAMPLES) {
    it(s.name, async () => {
      const db = await freshDb();
      const rows = await db.all<{ id: string; title: string }>("SELECT id, title FROM announcements");
      const rules = await loadRules(db, rows.map((r) => r.id));
      for (const [needle, overall] of Object.entries(s.expect)) {
        const row = rows.find((r) => r.title.includes(needle))!;
        const m = evaluateMatch((rules.get(row.id) ?? []) as Rule[], s.c, new Date().toISOString().slice(0, 10));
        expect(m.overall, `${s.name} / ${needle}`).toBe(overall);
      }
    });
  }
});
