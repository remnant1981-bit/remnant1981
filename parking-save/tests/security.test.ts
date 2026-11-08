import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createLimiter, clientKey } from "@/server/rate-limit";
import { verifyBearer, hashClient } from "@/server/admin";
import { GET as list } from "@/app/api/parking-lots/route";
import { POST as adminSync } from "@/app/api/admin/sync/route";
import { getAppDb } from "@/server/app-db";

const TOKEN = "t".repeat(40);
const req = (path: string, init: { method?: string; body?: string; headers?: Record<string, string>; ip?: string } = {}) =>
  new NextRequest("http://localhost" + path, { method: init.method, body: init.body, headers: { "x-forwarded-for": init.ip ?? "203.0.113.1", ...init.headers } });

describe("요청 제한", () => {
  it("윈도 내 초과 시 차단, 윈도 경과 후 해제, 키별 독립", () => {
    const l = createLimiter(3, 1000);
    expect([1, 2, 3].map(() => l.check("a", 0).ok)).toEqual([true, true, true]);
    const blocked = l.check("a", 100);
    expect(blocked).toMatchObject({ ok: false });
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(l.check("b", 100).ok).toBe(true);
    expect(l.check("a", 1001).ok).toBe(true);
  });
  it("클라이언트 키는 x-forwarded-for 첫 값", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientKey(new Headers())).toBe("unknown");
  });
  it("검색 API는 분당 60회 초과 시 429 + Retry-After", async () => {
    const q = "/api/parking-lots?destination=%EC%84%9C%EC%9A%B8%EC%8B%9C%EC%B2%AD&startAt=2026-11-09T10:00:00%2B09:00&endAt=2026-11-09T11:00:00%2B09:00";
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await list(req(q, { ip: "198.51.100.7" }))).status;
    expect(last).toBe(429);
    const res = await list(req(q, { ip: "198.51.100.7" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect((await list(req(q, { ip: "198.51.100.8" }))).status).toBe(200); // 다른 클라이언트는 영향 없음
  });
});

describe("관리자 API 인증", () => {
  it("Bearer 검증: 형식·값", () => {
    expect(verifyBearer(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(verifyBearer(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(verifyBearer(TOKEN, TOKEN)).toBe(false);
    expect(verifyBearer(null, TOKEN)).toBe(false);
  });
  it("감사로그용 클라이언트 해시는 원본 IP를 포함하지 않음", () => {
    expect(hashClient("203.0.113.1")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("POST /api/admin/sync", () => {
  const post = (ip: string, auth?: string, body: unknown = { job: "holidays" }) =>
    adminSync(req("/api/admin/sync", { method: "POST", ip, body: JSON.stringify(body), headers: auth ? { authorization: auth } : {} }));
  beforeEach(() => { delete process.env.ADMIN_API_TOKEN; delete process.env.DATA_GO_KR_SERVICE_KEY; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.ADMIN_API_TOKEN; delete process.env.DATA_GO_KR_SERVICE_KEY; });

  const audits = async () => (await (await getAppDb()).all<{ action: string; outcome: string; detail: string | null; client_hash: string }>("SELECT * FROM admin_audit_logs ORDER BY id"));

  it("토큰 미설정(또는 32자 미만)이면 비활성 503", async () => {
    expect((await post("10.0.0.1", `Bearer ${TOKEN}`)).status).toBe(503);
    process.env.ADMIN_API_TOKEN = "short";
    expect((await post("10.0.0.1", "Bearer short")).status).toBe(503);
  });
  it("인증 실패 401 + 감사로그(원본 IP·토큰 미저장)", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    expect((await post("10.0.0.2")).status).toBe(401);
    expect((await post("10.0.0.2", "Bearer wrong")).status).toBe(401);
    const logs = await audits();
    expect(logs.filter((l) => l.outcome === "DENIED").length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(logs)).not.toContain("10.0.0.2");
    expect(JSON.stringify(logs)).not.toContain("wrong");
  });
  it("인증 성공 후 job/키 검증", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    expect((await post("10.0.0.3", `Bearer ${TOKEN}`, { job: "nope" })).status).toBe(400);
    const r = await post("10.0.0.3", `Bearer ${TOKEN}`, { job: "holidays" });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("KEY_MISSING");
  });
  it("공휴일 동기화 실행(원천 호출은 합성 응답으로 대체) + 감사로그, 응답에 키 없음", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    process.env.DATA_GO_KR_SERVICE_KEY = "SECRET-SVC-KEY";
    vi.stubGlobal("fetch", async (u: URL) => {
      const sp = new URL(String(u)).searchParams; const y = sp.get("solYear"), m = Number(sp.get("solMonth"));
      const item = m === 1 ? [{ locdate: Number(`${y}0101`), isHoliday: "Y", dateName: "합성", dateKind: "01", seq: 1 }] : m === 12 ? [{ locdate: Number(`${y}1225`), isHoliday: "Y", dateName: "합성", dateKind: "01", seq: 1 }] : [];
      return new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: item.length ? { item } : "", totalCount: item.length } } }));
    });
    const res = await post("10.0.0.4", `Bearer ${TOKEN}`);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ job: "holidays", status: "SUCCESS" });
    expect(JSON.stringify(j)).not.toContain("SECRET-SVC-KEY");
    expect((await audits()).some((l) => l.action === "sync:holidays" && l.outcome === "OK")).toBe(true);
  });
  it("원천 장애 시 502 + FAILED 감사로그", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    process.env.DATA_GO_KR_SERVICE_KEY = "SECRET-SVC-KEY";
    vi.stubGlobal("fetch", async () => new Response("err", { status: 500 }));
    const res = await post("10.0.0.5", `Bearer ${TOKEN}`);
    expect(res.status).toBe(502);
    expect((await audits()).some((l) => l.outcome === "FAILED")).toBe(true);
  });
  it("서울 실시간 job: 키 없으면 400, 있으면 수집(합성 아닌 실제 샘플 응답 픽스처) + 감사로그, 응답에 키 없음", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    delete process.env.SEOUL_OPENAPI_KEY;
    const r0 = await post("10.0.0.7", `Bearer ${TOKEN}`, { job: "seoul-occupancy" });
    expect(r0.status).toBe(400);
    expect((await r0.json()).error.code).toBe("KEY_MISSING");
    process.env.SEOUL_OPENAPI_KEY = "SECRET-SEOUL-KEY";
    const body = (await import("node:fs")).readFileSync(new URL("./fixtures/seoul-getparkinginfo.sample.json", import.meta.url), "utf8");
    vi.stubGlobal("fetch", async (u: string) => { expect(String(u)).toContain("/SECRET-SEOUL-KEY/json/GetParkingInfo/1/1000/"); return new Response(body); });
    const res = await post("10.0.0.7", `Bearer ${TOKEN}`, { job: "seoul-occupancy" });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ job: "seoul-occupancy", status: "SUCCESS", lots: 5, snapshots: 5 });
    expect(JSON.stringify(j)).not.toContain("SECRET-SEOUL-KEY");
    expect((await audits()).some((l) => l.action === "sync:seoul-occupancy" && l.outcome === "OK")).toBe(true);
    delete process.env.SEOUL_OPENAPI_KEY;
  });
  it("관리자 API는 분당 5회 제한", async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post("10.0.0.6", "Bearer wrong")).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
