// 운영 현황 집계(일별 합계, 개인 정보 없음)
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteDb, migrate, type Db } from "@/server/db";
import { countUsage, flushUsage, resetUsageForTest, usageSeries, USAGE_RETENTION_DAYS } from "@/server/usage";
import { createLimiter } from "@/server/rate-limit";
import { log, setLogSink } from "@/server/log";

let db: Db;
beforeEach(async () => { db = await createSqliteDb(":memory:"); await migrate(db); resetUsageForTest(); });
const T = Date.parse("2026-11-14T10:00:00+09:00");

describe("운영 현황 집계", () => {
  it("메모리에 모았다가 한 번에 더함, KST 날짜 경계 기준", async () => {
    countUsage("search_page", T); countUsage("search_page", T); countUsage("lot_view", T);
    countUsage("search_page", Date.parse("2026-11-14T23:59:00+09:00"));
    countUsage("search_page", Date.parse("2026-11-15T00:01:00+09:00")); // 다음 날(KST)
    expect(await flushUsage(db, T)).toBe(5);
    expect(await flushUsage(db, T)).toBe(0); // 비었으면 아무것도 안 함
    countUsage("search_page", T);
    await flushUsage(db, T);
    expect(await db.all("SELECT ymd, metric, n FROM usage_daily ORDER BY ymd, metric")).toEqual([
      { ymd: "2026-11-14", metric: "lot_view", n: 1 }, { ymd: "2026-11-14", metric: "search_page", n: 4 }, { ymd: "2026-11-15", metric: "search_page", n: 1 },
    ]);
  });
  it("30일 시계열: 빈 날짜도 채움, 오늘이 마지막", async () => {
    countUsage("error", T);
    const s = await usageSeries(db, 30, T);
    expect(s).toHaveLength(30);
    expect(s[29]).toEqual({ ymd: "2026-11-14", metrics: { error: 1 } });
    expect(s[0]).toEqual({ ymd: "2026-10-16", metrics: {} });
  });
  it(`${USAGE_RETENTION_DAYS}일 지난 합계는 지움`, async () => {
    await db.run("INSERT INTO usage_daily(ymd, metric, n) VALUES ('2025-01-01','search_page',5)");
    countUsage("search_page", T); await flushUsage(db, T);
    expect(await db.get("SELECT COUNT(*) AS c FROM usage_daily WHERE ymd='2025-01-01'")).toEqual({ c: 0 });
  });
  it("저장 실패 시 건수를 잃지 않고 다음에 다시 저장", async () => {
    countUsage("report", T);
    const broken = { ...db, transaction: async () => { throw new Error("disk full"); } } as Db;
    await expect(flushUsage(broken, T)).rejects.toThrow();
    expect(await flushUsage(db, T)).toBe(1);
  });
  it("요청 제한 초과·오류 로그가 자동으로 집계됨", async () => {
    const l = createLimiter(1, 60_000);
    l.check("a", T); l.check("a", T); l.check("a", T);
    const prev = setLogSink(() => {});
    try { log("error", "x", {}, T); } finally { setLogSink(prev); }
    await flushUsage(db, T);
    const rows = Object.fromEntries((await db.all<{ metric: string; n: number }>("SELECT metric, n FROM usage_daily")).map((r) => [r.metric, r.n]));
    expect(rows.rate_limited).toBe(2);
    expect(rows.error).toBe(1);
  });
});

import { NextRequest } from "next/server";
import { GET as stats } from "@/app/api/admin/stats/route";
describe("GET /api/admin/stats", () => {
  const TOKEN = "s".repeat(40);
  const get = (auth?: string) => stats(new NextRequest("http://localhost/api/admin/stats", { headers: { "x-forwarded-for": "203.0.113.50", ...(auth ? { authorization: auth } : {}) } }));
  it("인증 없으면 401, 인증 시 30일 시계열·신선도·건수", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    try {
      expect((await get()).status).toBe(401);
      const res = await get(`Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.days).toHaveLength(30);
      expect(body).toHaveProperty("freshness");
      expect(body.counts).toMatchObject({ lots: expect.any(Number), pending: expect.any(Number), overrides: expect.any(Number) });
      expect(JSON.stringify(body)).not.toContain("203.0.113.50");
    } finally { delete process.env.ADMIN_API_TOKEN; }
  });
});
