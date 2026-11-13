import { beforeEach, describe, expect, it } from "vitest";
import { handlers } from "@/server/handlers";
import { client, freshDb, TODAY, type Client } from "./helpers";
import type { Db } from "@/server/db";
import { addMonths, paidPeriod, quote, trialEnd } from "@/domain/billing";

function validBiz(p9: string) { const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0; for (let i = 0; i < 9; i++) s += Number(p9[i]) * w[i]; s += Math.floor((Number(p9[8]) * 5) / 10); return p9 + ((10 - (s % 10)) % 10); }
const PW = "Password123!";
let db: Db;
beforeEach(async () => { db = await freshDb({ admin: true }); });

async function admin(): Promise<Client> {
  const a = await client(handlers);
  await a.call("POST", "/api/auth/login", { email: "admin@example.test", password: "AdminPass12345" });
  await a.call("GET", "/api/auth/me");
  return a;
}
async function member(email: string, p9: string, adm: Client): Promise<Client> {
  const c = await client(handlers);
  await c.call("POST", "/api/auth/register", { email, password: PW });
  await c.call("GET", "/api/auth/me");
  await c.call("POST", "/api/company/claim", { bizNo: validBiz(p9) });
  const claim = ((await adm.call("GET", "/api/admin/claims")).body.items as any[]).find((x) => x.email === email);
  await adm.call("POST", "/api/admin/claims", { userId: claim.user_id, companyId: claim.company_id, decision: "approve" });
  return c;
}
const req = { plan: "pro", cycle: "yearly", depositorName: "에이사", invoiceEmail: "tax@example.test", agree: true };

describe("요금 계산(domain/billing)", () => {
  it("월·연 결제, Team 추가 인원, 부가세", () => {
    expect(quote("pro", "monthly", 1)).toMatchObject({ supply: 19000, vat: 1900, total: 20900, months: 1 });
    expect(quote("pro", "yearly", 1)).toMatchObject({ supply: 190000, vat: 19000, total: 209000, months: 12 });
    expect(quote("team", "monthly", 5)).toMatchObject({ extra: 0, supply: 49000, total: 53900 });
    expect(quote("team", "monthly", 7)).toMatchObject({ extraSeats: 2, extra: 10000, supply: 59000 });
    expect(quote("team", "yearly", 7)).toMatchObject({ extra: 100000, supply: 590000, total: 649000 });
  });
  it("기간 계산: 말일 보정·연장·체험 14일", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(paidPeriod("2026-11-13", 1, null)).toEqual({ start: "2026-11-13", end: "2026-12-12" });
    expect(paidPeriod("2026-11-13", 12, null)).toEqual({ start: "2026-11-13", end: "2027-11-12" });
    expect(paidPeriod("2026-11-13", 1, "2026-11-30")).toEqual({ start: "2026-12-01", end: "2026-12-31" }); // 유효 기간 이어서 연장
    expect(paidPeriod("2026-11-13", 1, "2026-11-01")).toEqual({ start: "2026-11-13", end: "2026-12-12" }); // 만료 후엔 오늘부터
    expect(trialEnd("2026-11-13")).toBe("2026-11-26");
  });
});

describe("체험·이용 신청 → 입금 확인 → 활성화", () => {
  it("전체 흐름과 권한", async () => {
    const adm = await admin();
    const a = await member("a@example.test", "123456789", adm);
    // 비로그인·기업 미확인 차단
    const anon = await client(handlers);
    expect((await anon.call("GET", "/api/billing")).status).toBe(401);
    const pend = await client(handlers);
    await pend.call("POST", "/api/auth/register", { email: "p@example.test", password: PW });
    await pend.call("GET", "/api/auth/me");
    expect((await pend.call("POST", "/api/billing/trial", { plan: "pro" })).status).toBe(403);

    // 셀프 체험(기업당 1회)
    let st = (await a.call("GET", "/api/billing")).body;
    expect(st).toMatchObject({ trialAvailable: true, pending: null, plan: { plan: "free" } });
    expect((await a.call("POST", "/api/billing/trial", { plan: "gold" })).status).toBe(400);
    st = (await a.call("POST", "/api/billing/trial", { plan: "team" })).body;
    expect(st.plan).toMatchObject({ plan: "team", status: "trial", endsAt: trialEnd(TODAY), seats: 5 });
    expect(st.trialAvailable).toBe(false);
    expect((await a.call("POST", "/api/billing/trial", { plan: "pro" })).body.error).toBe("trial_used");

    // 신청 검증: 금액은 서버 계산(클라이언트 값 무시), 동의·인원·이메일 검사
    expect((await a.call("POST", "/api/billing/requests", { ...req, agree: false })).status).toBe(400);
    expect((await a.call("POST", "/api/billing/requests", { ...req, seats: 3 })).status).toBe(400); // Pro 는 1명
    expect((await a.call("POST", "/api/billing/requests", { ...req, plan: "team", seats: 4 })).status).toBe(400);
    expect((await a.call("POST", "/api/billing/requests", { ...req, invoiceEmail: "x" })).status).toBe(400);
    expect((await a.call("POST", "/api/billing/requests", { ...req, cycle: "weekly" })).status).toBe(400);
    st = (await a.call("POST", "/api/billing/requests", { ...req, plan: "team", seats: 6, cycle: "monthly", amount_total: 1 })).body;
    expect(st.pending).toMatchObject({ plan: "team", seats: 6, amount_supply: 54000, amount_vat: 5400, amount_total: 59400, status: "pending" });
    expect((await a.call("POST", "/api/billing/requests", req)).body.error).toBe("request_pending");
    // 취소 후 재신청
    expect((await a.call("DELETE", "/api/billing/requests", { requestId: st.pending.id })).body.pending).toBeNull();
    st = (await a.call("POST", "/api/billing/requests", req)).body;
    const rid = st.pending.id;

    // 다른 기업은 남의 신청을 보거나 취소할 수 없음(IDOR)
    const b = await member("b@example.test", "220811234", adm);
    expect((await b.call("GET", "/api/billing")).body.history).toEqual([]);
    expect((await b.call("DELETE", "/api/billing/requests", { requestId: rid })).status).toBe(404);
    // 일반 사용자는 관리자 API 접근 불가
    expect((await a.call("GET", "/api/admin/plan-requests")).status).toBe(404);
    expect((await a.call("POST", "/api/admin/plan-requests", { requestId: rid, decision: "approve" })).status).toBe(404);

    // 관리자 입금 확인 → Pro 연 결제 활성화(체험 종료일 유지)
    const list = (await adm.call("GET", "/api/admin/plan-requests")).body.items as any[];
    expect(list[0]).toMatchObject({ id: rid, status: "pending", amount_total: 209000, depositor_name: "에이사", email: "a@example.test" });
    const done = (await adm.call("POST", "/api/admin/plan-requests", { requestId: rid, decision: "approve", adminMemo: "11/13 입금" })).body;
    expect(done).toMatchObject({ status: "approved", paidFrom: TODAY, paidUntil: paidPeriod(TODAY, 12, null).end, plan: { plan: "pro", status: "active" } });
    expect((await adm.call("POST", "/api/admin/plan-requests", { requestId: rid, decision: "approve" })).body.error).toBe("already_processed");
    st = (await a.call("GET", "/api/billing")).body;
    expect(st.plan).toMatchObject({ plan: "pro", status: "active", endsAt: done.paidUntil });
    expect(st.history.find((r: any) => r.id === rid).status).toBe("approved");
    const sub = await db.get<any>("SELECT trial_ends_at, memo FROM subscriptions s JOIN company_members m ON m.company_id=s.company_id JOIN users u ON u.id=m.user_id WHERE u.email='a@example.test'");
    expect(sub.trial_ends_at).toBe(trialEnd(TODAY));
    expect(sub.memo).toContain("209,000원");
    expect((await db.get<any>("SELECT COUNT(*) n FROM admin_audit_logs WHERE action='plan_request.approve'")).n).toBe(1);

    // 같은 요금제 재결제 → 기존 종료일 다음 날부터 연장
    await a.call("POST", "/api/billing/requests", { ...req, cycle: "monthly" });
    const rid2 = (await a.call("GET", "/api/billing")).body.pending.id;
    const ext = (await adm.call("POST", "/api/admin/plan-requests", { requestId: rid2, decision: "approve" })).body;
    expect(ext.paidUntil).toBe(paidPeriod(TODAY, 1, done.paidUntil).end);

    // 반려
    await b.call("POST", "/api/billing/requests", { ...req, invoiceEmail: "b@example.test" });
    const rid3 = (await b.call("GET", "/api/billing")).body.pending.id;
    expect((await adm.call("POST", "/api/admin/plan-requests", { requestId: rid3, decision: "maybe" })).status).toBe(400);
    await adm.call("POST", "/api/admin/plan-requests", { requestId: rid3, decision: "reject", adminMemo: "미입금" });
    const bs = (await b.call("GET", "/api/billing")).body;
    expect(bs).toMatchObject({ pending: null, plan: { plan: "free" } });
    expect(bs.history[0]).toMatchObject({ status: "rejected", admin_memo: "미입금" });
  });

  it("관리자가 이미 체험을 설정한 기업은 셀프 체험 불가, 입금 계좌는 환경변수로만 표시", async () => {
    const adm = await admin();
    const a = await member("a@example.test", "123456789", adm);
    const cid = (await adm.call("GET", "/api/admin/subscriptions")).body.items[0].company_id;
    await adm.call("PUT", "/api/admin/subscriptions", { companyId: cid, plan: "pro", trialEndsAt: "2999-12-31" });
    let st = (await a.call("GET", "/api/billing")).body;
    expect(st.trialAvailable).toBe(false);
    expect(st.payment).toEqual({ bankAccount: null, contact: null });
    process.env.BILLING_BANK_ACCOUNT = "테스트은행 000-000 예금주";
    try {
      st = (await a.call("GET", "/api/billing")).body;
      expect(st.payment.bankAccount).toBe("테스트은행 000-000 예금주");
    } finally { delete process.env.BILLING_BANK_ACCOUNT; }
  });
});
