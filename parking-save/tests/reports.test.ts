// 정보 오류 신고 API: 검증·출처 확인·중복 접수·요청 제한·저장 내용(개인정보 최소화)
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/parking-lots/[id]/reports/route";
import { getAppDb } from "@/server/app-db";
import { decideReport, listReports, parseReport } from "@/server/reports";

let ip = 0;
const post = (id: string, body: unknown, headers: Record<string, string> = {}) => {
  const h = { "content-type": "application/json", host: "localhost", "x-forwarded-for": `198.51.100.${++ip % 250}`, ...headers };
  return POST(new NextRequest(`http://localhost/api/parking-lots/${id}/reports`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: h }), { params: Promise.resolve({ id }) });
};

describe("정보 오류 신고", () => {
  it("본문 검증: 유형 필수, 내용 500자, 제어문자 제거", () => {
    expect(parseReport({}).ok).toBe(false);
    expect(parseReport({ category: "NOPE" }).ok).toBe(false);
    expect(parseReport({ category: "FEE", message: "x".repeat(501) })).toMatchObject({ ok: false, code: "MESSAGE_TOO_LONG" });
    expect(parseReport({ category: "FEE", message: " a\u0007b " })).toEqual({ ok: true, category: "FEE", message: "ab" });
    expect(parseReport({ category: "OTHER", message: "   " })).toEqual({ ok: true, category: "OTHER", message: null });
  });

  it("접수(201) → 같은 클라이언트·시설·유형 24시간 내 재신고는 중복(200)으로 쌓지 않음 → 관리자 처리", async () => {
    const h = { "x-forwarded-for": "203.0.113.77" };
    const r1 = await post("1", { category: "FEE", message: "요금이 바뀜" }, h);
    expect(r1.status).toBe(201);
    const r2 = await post("1", { category: "FEE", message: "다시" }, h);
    expect(r2.status).toBe(200);
    expect((await r2.json()).duplicate).toBe(true);
    const db = await getAppDb();
    const rows = await db.all<{ client_hash: string; message: string }>("SELECT client_hash, message FROM lot_reports WHERE parking_lot_id=1");
    expect(rows.length).toBe(1);
    expect(rows[0].client_hash).toMatch(/^[0-9a-f]{16}$/); // IP 원문은 저장하지 않음
    const pending = await listReports(db);
    expect(pending.some((p) => p.message === "요금이 바뀜")).toBe(true);
    expect(await decideReport(db, pending[0].id, "REVIEWED", "관리자")).toBe(true);
    expect(await decideReport(db, pending[0].id, "REVIEWED", "관리자")).toBe(false);
  });

  it("다른 사이트에서 보낸 요청(Origin 불일치) 403, 없는 시설 404, 잘못된 ID·본문 400", async () => {
    expect((await post("1", { category: "FEE" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("1", { category: "FEE" }, { origin: "http://localhost" })).status).toBe(201);
    expect((await post("999999", { category: "FEE" })).status).toBe(404);
    expect((await post("abc", { category: "FEE" })).status).toBe(400);
    expect((await post("1", "{not json")).status).toBe(400);
  });

  it("요청 제한: 같은 클라이언트 시간당 5회 초과 시 429", async () => {
    const h = { "x-forwarded-for": "192.0.2.200" };
    const codes: number[] = [];
    for (const c of ["FEE", "HOURS", "LOCATION", "CLOSED", "OTHER", "FEE"]) codes.push((await post("2", { category: c }, h)).status);
    expect(codes.slice(0, 5).every((s) => s === 201 || s === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});
