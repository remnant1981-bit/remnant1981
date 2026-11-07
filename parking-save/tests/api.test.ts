import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as list } from "@/app/api/parking-lots/route";
import { GET as detail } from "@/app/api/parking-lots/[id]/route";

const url = (p: string) => new NextRequest("http://localhost" + p);
const P = "startAt=2026-11-09T10:00:00%2B09:00&endAt=2026-11-09T11:00:00%2B09:00";

describe("GET /api/parking-lots", () => {
  it("정상: 목업 표시·no-store", async () => {
    const res = await list(url(`/api/parking-lots?destination=${encodeURIComponent("서울시청")}&${P}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const j = await res.json();
    expect(j.dataCoverage.isMockData).toBe(true);
    expect(j.requestedPeriod.timezone).toBe("Asia/Seoul");
    expect(j.items.length).toBeGreaterThan(0);
  });
  it("400: 사용자용 메시지만", async () => {
    const res = await list(url(`/api/parking-lots?${P}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MISSING_CENTER");
  });
});

describe("GET /api/parking-lots/{id}", () => {
  it("200/404/400", async () => {
    expect((await detail(url("/api/parking-lots/1"), { params: Promise.resolve({ id: "1" }) })).status).toBe(200);
    expect((await detail(url("/api/parking-lots/9999"), { params: Promise.resolve({ id: "9999" }) })).status).toBe(404);
    expect((await detail(url("/api/parking-lots/abc"), { params: Promise.resolve({ id: "abc" }) })).status).toBe(400);
    expect((await detail(url("/api/parking-lots/1?startAt=bad&endAt=bad"), { params: Promise.resolve({ id: "1" }) })).status).toBe(400);
  });
});
