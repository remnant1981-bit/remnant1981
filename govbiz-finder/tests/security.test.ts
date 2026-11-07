import { beforeEach, describe, expect, it } from "vitest";
import { handlers } from "@/server/handlers";
import { client, freshDb, type Client } from "./helpers";
import type { Db } from "@/server/db";

const EMAIL_A = "a@example.test";
const EMAIL_B = "b@example.test";
const PW = "Passw0rdPassw0rd";
let db: Db;

function validBiz(prefix9: string): string {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(prefix9[i]) * w[i];
  s += Math.floor((Number(prefix9[8]) * 5) / 10);
  return prefix9 + ((10 - (s % 10)) % 10);
}
const BIZ1 = validBiz("123456789");
const BIZ2 = validBiz("987654321");

async function signup(email: string): Promise<Client> {
  const c = await client(handlers);
  const r = await c.call("POST", "/api/auth/register", { email, password: PW });
  expect(r.status).toBe(200);
  await c.call("GET", "/api/auth/me");
  return c;
}
async function adminClient(): Promise<Client> {
  const c = await client(handlers);
  expect((await c.call("POST", "/api/auth/login", { email: "admin@example.test", password: "AdminPass12345" })).status).toBe(200);
  await c.call("GET", "/api/auth/me");
  return c;
}
/** 가입 → 기업 신청 → 관리자 승인 */
async function verifiedUser(email: string, biz: string, admin: Client): Promise<Client> {
  const c = await signup(email);
  expect((await c.call("POST", "/api/company/claim", { bizNo: biz })).status).toBe(200);
  const claims = (await admin.call("GET", "/api/admin/claims")).body.items as any[];
  const mine = claims.find((x) => x.email === email);
  expect((await admin.call("POST", "/api/admin/claims", { userId: mine.user_id, companyId: mine.company_id, decision: "approve" })).status).toBe(200);
  return c;
}

beforeEach(async () => {
  db = await freshDb({ admin: true });
});

describe("권한/보안 (TEST_PLAN §3)", () => {
  it("1. 비회원은 기업별 이력·프로필·관심 공고에 접근할 수 없다", async () => {
    const c = await client(handlers);
    for (const [m, p] of [["GET", "/api/company"], ["GET", "/api/history"], ["GET", "/api/bookmarks"], ["GET", "/api/notifications"], ["GET", "/api/recommendations"]] as const) {
      expect((await c.call(m, p)).status).toBe(401);
    }
  });

  it("2. 인증 미완료(기업 관계 미확인) 회원은 기업 데이터에 접근할 수 없다", async () => {
    const u = await signup(EMAIL_A);
    expect((await u.call("POST", "/api/company/claim", { bizNo: BIZ1 })).body.status).toBe("pending");
    expect((await u.call("GET", "/api/company")).body.company).toBeNull();
    for (const p of ["/api/history", "/api/bookmarks", "/api/recommendations", "/api/notifications"]) {
      expect((await u.call("GET", p)).status).toBe(403);
    }
    expect((await u.call("PUT", "/api/company", { company_name: "x" })).status).toBe(403);
  });

  it("3,4. 기업 A 사용자는 기업 B 데이터에 접근할 수 없고 company_id 를 바꿔도 우회 불가", async () => {
    const admin = await adminClient();
    const a = await verifiedUser(EMAIL_A, BIZ1, admin);
    const b = await verifiedUser(EMAIL_B, BIZ2, admin);
    await a.call("PUT", "/api/company", { company_name: "A사", region_sido: "경기도" });
    await b.call("PUT", "/api/company", { company_name: "B사", region_sido: "서울특별시" });
    const bId = (await b.call("GET", "/api/company")).body.company.id as string;
    // 클라이언트가 B 의 company_id 를 보내도 서버는 세션 기준으로만 판단
    const forged = await a.call("PUT", "/api/company", { company_name: "해킹", id: bId, company_id: bId, companyId: bId });
    expect(forged.status).toBe(200);
    expect(forged.body.company.id).not.toBe(bId);
    expect((await b.call("GET", "/api/company")).body.company.company_name).toBe("B사");
    // 서비스 계층에서도 타 기업 ID 직접 지정 차단
    const { getCompanyProfile } = await import("@/server/company");
    const userA = (await db.get<{ id: string }>("SELECT id FROM users WHERE email=?", [EMAIL_A]))!;
    await expect(getCompanyProfile(db, userA.id, bId)).rejects.toMatchObject({ status: 404 });
    // 관심 공고/이력 격리
    const anns = (await a.call("GET", "/api/announcements")).body.rows as any[];
    expect((await a.call("POST", "/api/bookmarks", { announcementId: anns[0].id })).status).toBe(200);
    expect((await a.call("GET", "/api/bookmarks")).body.items.length).toBe(1);
    expect((await b.call("GET", "/api/bookmarks")).body.items.length).toBe(0);
    expect(JSON.stringify((await b.call("GET", "/api/history")).body)).not.toContain(anns[0].title);
  });

  it("5. 사업자번호만으로 기존 기업 데이터가 조회/노출되지 않는다", async () => {
    const admin = await adminClient();
    const a = await verifiedUser(EMAIL_A, BIZ1, admin);
    await a.call("PUT", "/api/company", { company_name: "A사비밀", representative_name: "홍길동" });
    // 공격자가 같은 번호로 신청
    const x = await signup("attacker@example.test");
    const r = await x.call("POST", "/api/company/claim", { bizNo: BIZ1 });
    expect(JSON.stringify(r.body)).not.toMatch(/A사비밀|홍길동/);
    expect(r.body.status).toBe("pending");
    expect((await x.call("GET", "/api/company")).body.company).toBeNull();
    // 승인되지 않으므로 기업 데이터 접근 불가
    expect((await x.call("GET", "/api/bookmarks")).status).toBe(403);
    // 공개 상태조회 API 도 저장된 기업 정보를 반환하지 않음
    const pub = await (await client(handlers)).call("POST", "/api/nts/status", { bizNo: BIZ1 });
    expect(JSON.stringify(pub.body)).not.toMatch(/A사비밀|홍길동/);
    expect(JSON.stringify(pub.body)).not.toContain(BIZ1);
    // 기업당 대표 1명: 이미 확인된 대표가 있으면 승인 불가
    const claim = ((await admin.call("GET", "/api/admin/claims")).body.items as any[]).find((i) => i.email === "attacker@example.test");
    expect((await admin.call("POST", "/api/admin/claims", { userId: claim.user_id, companyId: claim.company_id, decision: "approve" })).status).toBe(409);
  });

  it("6. 계정 존재 여부를 응답 차이로 추측할 수 없다", async () => {
    await signup(EMAIL_A);
    const c = await client(handlers);
    const dup = await c.call("POST", "/api/auth/register", { email: EMAIL_A, password: PW });
    const fresh = await (await client(handlers)).call("POST", "/api/auth/register", { email: "new@example.test", password: PW });
    expect(dup.status).toBe(fresh.status);
    expect(dup.body).toEqual(fresh.body);
    expect(dup.res.headers.get("set-cookie")).toBeNull(); // 중복이면 세션 미발급
    const l1 = await (await client(handlers)).call("POST", "/api/auth/login", { email: EMAIL_A, password: "wrong-password1" });
    const l2 = await (await client(handlers)).call("POST", "/api/auth/login", { email: "nobody@example.test", password: "wrong-password1" });
    expect(l1.status).toBe(l2.status);
    expect(l1.body).toEqual(l2.body);
  });

  it("7. 비밀번호·사업자번호·토큰이 로그/DB 평문에 노출되지 않는다", async () => {
    const { redact, redactString } = await import("@/lib/log");
    expect(redactString(`biz ${BIZ1} 123-45-67891 Bearer abc.def`)).not.toMatch(/\d{3}-?\d{2}-?\d{5}|abc\.def/);
    expect(JSON.stringify(redact({ password: "x", token: "y", business_number: BIZ1, ok: 1 }))).not.toMatch(/"x"|"y"/);
    const admin = await adminClient();
    await verifiedUser(EMAIL_A, BIZ1, admin);
    const co = await db.get<Record<string, string>>("SELECT * FROM companies LIMIT 1");
    expect(JSON.stringify(co)).not.toContain(BIZ1);
    expect(co!.business_number_masked).toBe(`${BIZ1.slice(0, 3)}-**-***${BIZ1.slice(8)}`);
    const u = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email=?", [EMAIL_A]);
    expect(u!.password_hash).not.toContain(PW);
    expect(u!.password_hash.startsWith("$2")).toBe(true);
    const sess = await db.all<{ id: string }>("SELECT id FROM sessions");
    const cookie = (await signup("c@example.test")).cookie.split("=")[1];
    expect(sess.every((s) => s.id !== cookie)).toBe(true);
    expect((await db.all<{ id: string }>("SELECT id FROM sessions")).some((s) => s.id === cookie)).toBe(false); // 평문 토큰은 DB에 없음
  });

  it("8. 관리자 API 를 일반 회원/비회원이 호출할 수 없다", async () => {
    const u = await signup(EMAIL_A);
    const anon = await client(handlers);
    for (const [m, p, body] of [
      ["GET", "/api/admin/overview"], ["GET", "/api/admin/claims"], ["GET", "/api/admin/audit"], ["POST", "/api/admin/collect", { sourceId: "mock" }],
      ["POST", "/api/admin/announcements", { title: "x" }],
    ] as const) {
      expect([401, 404]).toContain((await anon.call(m, p, body as any)).status);
      expect([401, 404]).toContain((await u.call(m, p, body as any)).status);
    }
    expect((await u.call("GET", "/api/admin/overview")).status).toBe(404);
  });

  it("로그인 반복 실패 시 계정 잠금(올바른 비밀번호도 일정 시간 거부)", async () => {
    await signup(EMAIL_A);
    for (let i = 0; i < 5; i++) await (await client(handlers)).call("POST", "/api/auth/login", { email: EMAIL_A, password: "wrong-password1" });
    const r = await (await client(handlers)).call("POST", "/api/auth/login", { email: EMAIL_A, password: PW });
    expect(r.status).toBe(401);
  });

  it("CSRF: 토큰 없음/타 출처 요청 차단, 로그아웃 후 세션 무효", async () => {
    const admin = await adminClient();
    const a = await verifiedUser(EMAIL_A, BIZ1, admin);
    expect((await a.call("PUT", "/api/company", { company_name: "x" }, { "x-csrf-token": "bad" })).status).toBe(403);
    expect((await a.call("PUT", "/api/company", { company_name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    const oldCookie = a.cookie;
    expect((await a.call("POST", "/api/auth/logout")).status).toBe(200);
    const stale = await client(handlers);
    stale.cookie = oldCookie;
    expect((await stale.call("GET", "/api/auth/me")).body.user).toBeNull();
  });

  it("SQL Injection/XSS 입력은 파라미터 바인딩·저장 후에도 안전하다", async () => {
    const c = await client(handlers);
    const r = await c.call("GET", "/api/announcements?q=" + encodeURIComponent("' OR 1=1; DROP TABLE users;--"));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    expect(await db.get("SELECT COUNT(*) AS n FROM users")).toBeTruthy();
    const admin = await adminClient();
    const bad = await admin.call("POST", "/api/admin/announcements", { title: "x", organization: "y", url: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
  });

  it("DEV 자동 승인은 production 에서 동작하지 않는다", async () => {
    process.env.DEV_AUTO_APPROVE_COMPANY = "true";
    const origEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = "production";
    try {
      const u = await signup(EMAIL_A);
      expect((await u.call("POST", "/api/company/claim", { bizNo: BIZ1 })).body.status).toBe("pending");
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      process.env.DEV_AUTO_APPROVE_COMPANY = "false";
    }
  });
});
