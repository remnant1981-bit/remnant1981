import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import type { Db } from "@/server/db";
import { login, register } from "@/server/auth";
import { requestCompanyClaim } from "@/server/company";
import { parseSearchParams, searchAnnouncements, toQueryString } from "@/domain/search";
import { runSource } from "@/collector/runner";
import { conditionLines } from "@/export";

let db: Db;
const prev = process.env.DEV_AUTO_APPROVE_COMPANY;
beforeEach(async () => { db = await freshDb({ mock: false }); });
afterEach(() => { if (prev === undefined) delete process.env.DEV_AUTO_APPROVE_COMPANY; else process.env.DEV_AUTO_APPROVE_COMPANY = prev; });

describe("실사용자 점검 반영", () => {
  it("잠금 시간이 지나면 실패 횟수를 새로 센다(1회 실패로 재잠금되지 않음)", async () => {
    const r = await register(db, "lock@example.test", "LockPass12345", "t1");
    expect(r.created).toBe(true);
    for (let i = 0; i < 5; i++) await login(db, "lock@example.test", "wrong-password", `k${i}`).catch(() => null);
    const u = () => db.get<{ failed_logins: number; locked_until: string | null }>("SELECT failed_logins, locked_until FROM users WHERE email='lock@example.test'");
    expect((await u())!.locked_until).not.toBeNull();
    await db.run("UPDATE users SET locked_until=? WHERE email='lock@example.test'", [new Date(Date.now() - 1000).toISOString()]);
    await login(db, "lock@example.test", "wrong-password", "k9").catch(() => null);
    expect(await u()).toMatchObject({ failed_logins: 1, locked_until: null });
    await expect(login(db, "lock@example.test", "LockPass12345", "k10")).resolves.toBeTruthy();
  });

  it("자동 승인 실패(이미 대표 있음) 시 대기 신청이 남지 않아 다른 번호로 신청 가능", async () => {
    process.env.DEV_AUTO_APPROVE_COMPANY = "true";
    const a = await register(db, "a@example.test", "UserPass12345", "a");
    const b = await register(db, "b@example.test", "UserPass12345", "b");
    if (!a.created || !b.created) throw new Error("register");
    expect((await requestCompanyClaim(db, a.userId, "1234567891")).status).toBe("verified");
    await expect(requestCompanyClaim(db, b.userId, "1234567891")).rejects.toMatchObject({ status: 409 });
    expect((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM company_members WHERE user_id=?", [b.userId]))!.n).toBe(0);
    expect((await requestCompanyClaim(db, b.userId, "2208162517")).status).toBe("verified");
  });

  it("지역 공고만 보기: 전국 공고 제외, 조건 문자열·내보내기 조건에 반영", async () => {
    await runSource(db, { sourceId: "bizinfo", fetch: async () => [["전국", "N"], ["경기도", "G"], ["부산광역시", "B"]].map(([regionScope, k]) => ({
      sourceNoticeId: `L-${k}`, url: `https://example.org/l/${k}`, title: `지역 테스트 ${k}`, organization: "기관", categories: ["rnd"], regionScope,
    })) }, { retries: 0 });
    const base = parseSearchParams({ region: "경기도" });
    expect((await searchAnnouncements(db, base)).total).toBe(2);
    const local = parseSearchParams({ region: "경기도", local: "1" });
    const res = await searchAnnouncements(db, local);
    expect(res.rows.map((r) => r.region_scope)).toEqual(["경기도"]);
    expect(toQueryString(local)).toContain("local=1");
    expect(conditionLines(local).join("|")).toContain("전국 공고 제외");
    expect(conditionLines(local).join("|")).toContain("정렬: 최신순");
  });
});
