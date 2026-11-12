// 관리자 API(관리자 화면용): 인증·현황·신고/중복 후보 처리·감사로그
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as overview } from "@/app/api/admin/overview/route";
import { GET as quality } from "@/app/api/admin/quality/route";
import { POST as reportAct } from "@/app/api/admin/reports/[id]/route";
import { POST as dupAct } from "@/app/api/admin/duplicates/[id]/route";
import { getAppDb } from "@/server/app-db";

const TOKEN = "t".repeat(40);
const env = process.env as Record<string, string | undefined>;
let saved: string | undefined;
beforeAll(() => { saved = env.ADMIN_API_TOKEN; env.ADMIN_API_TOKEN = TOKEN; });
afterAll(() => { if (saved === undefined) delete env.ADMIN_API_TOKEN; else env.ADMIN_API_TOKEN = saved; });

let ip = 0;
const req = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const h = new Headers(init.headers);
  h.set("x-forwarded-for", `192.0.2.${++ip % 250}`);
  if (init.token !== null) h.set("authorization", `Bearer ${init.token ?? TOKEN}`);
  return new Request(`http://localhost${path}`, { ...init, headers: h });
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("관리자 API", () => {
  it("토큰 없거나 틀리면 401(감사로그), 토큰 미설정이면 503", async () => {
    expect((await overview(req("/api/admin/overview", { token: null }))).status).toBe(401);
    expect((await overview(req("/api/admin/overview", { token: "x".repeat(40) }))).status).toBe(401);
    const db = await getAppDb();
    expect(((await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM admin_audit_logs WHERE action='admin:overview' AND outcome='DENIED'"))!.c)).toBeGreaterThanOrEqual(2);
    env.ADMIN_API_TOKEN = "short";
    expect((await overview(req("/api/admin/overview"))).status).toBe(503);
    env.ADMIN_API_TOKEN = TOKEN;
  });

  it("현황 → 신고 처리(재처리는 409) → 중복 후보 승인", async () => {
    const db = await getAppDb();
    await db.run("INSERT INTO lot_reports(parking_lot_id, category, message, created_at, client_hash) VALUES (1,'HOURS','운영시간 변경', ?, 'abc')", [new Date().toISOString()]);
    const lots = await db.all<{ id: number }>("SELECT id FROM parking_lots ORDER BY id LIMIT 2");
    await db.run("INSERT OR IGNORE INTO duplicate_candidates(lot_a_id, lot_b_id, score, reason, status, created_at) VALUES (?,?,1,'테스트','PENDING',?)", [lots[0].id, lots[1].id, new Date().toISOString()]);
    const o = await (await overview(req("/api/admin/overview"))).json();
    expect(o.counts.reports).toBeGreaterThanOrEqual(1);
    const rep = o.reports.find((r: { message: string }) => r.message === "운영시간 변경");
    expect(rep).toBeTruthy();
    const body = (b: unknown) => ({ method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
    expect((await reportAct(req(`/api/admin/reports/${rep.id}`, body({ status: "REVIEWED" })), ctx(String(rep.id)))).status).toBe(400); // 처리자 이름 필수
    expect((await reportAct(req(`/api/admin/reports/${rep.id}`, body({ status: "BAD", by: "관리자" })), ctx(String(rep.id)))).status).toBe(400);
    expect((await reportAct(req(`/api/admin/reports/${rep.id}`, body({ status: "REVIEWED", by: "관리자" })), ctx(String(rep.id)))).status).toBe(200);
    expect((await reportAct(req(`/api/admin/reports/${rep.id}`, body({ status: "REVIEWED", by: "관리자" })), ctx(String(rep.id)))).status).toBe(409);
    const dup = o.duplicates[0];
    expect((await dupAct(req(`/api/admin/duplicates/${dup.id}`, body({ decision: "MERGED", by: "관리자" })), ctx(String(dup.id)))).status).toBe(200);
    expect((await db.get<{ status: string }>("SELECT status FROM duplicate_candidates WHERE id=?", [dup.id]))!.status).toBe("MERGED");
    expect(((await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM admin_audit_logs WHERE action IN ('report:review','duplicate:approve') AND outcome='OK'"))!.c)).toBeGreaterThanOrEqual(2);
  });

  it("품질 리포트 조회", async () => {
    const res = await quality(req("/api/admin/quality"));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).alerts)).toBe(true);
  });
});
