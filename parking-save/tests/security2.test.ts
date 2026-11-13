// 출시 전 보안 점검 보강: 요청 제한기 메모리 상한, 공유 이미지 캐시·요청 제한, 언어 전환 요청 제한, HSTS
import { describe, expect, it } from "vitest";
import { createLimiter } from "@/server/rate-limit";
import { ogCacheStats, ogImageCached, resetOgCacheForTest } from "@/server/og";
import { NextRequest } from "next/server";

describe("요청 제한기 메모리 상한", () => {
  it("많은 주소에서 동시에 몰려도 보관 키 수가 상한을 넘지 않음", () => {
    const l = createLimiter(5, 60_000, 1000) as ReturnType<typeof createLimiter> & { check: (k: string, n?: number) => { ok: boolean } };
    const now = 1_000_000;
    for (let i = 0; i < 5000; i++) l.check(`10.0.${i >> 8}.${i & 255}`, now);
    // 상한 이후에도 새 클라이언트는 정상 처리되고, 최근 클라이언트의 제한은 유지됨
    const key = "203.0.113.9";
    for (let i = 0; i < 5; i++) expect(l.check(key, now).ok).toBe(true);
    expect(l.check(key, now).ok).toBe(false);
  });
  it("창이 지나면 다시 허용", () => {
    const l = createLimiter(2, 1000);
    expect([l.check("a", 0).ok, l.check("a", 1).ok, l.check("a", 2).ok]).toEqual([true, true, false]);
    expect(l.check("a", 1001).ok).toBe(true);
  });
});

describe("공유 이미지 캐시", () => {
  it("같은 시설은 1시간 동안 다시 그리지 않고 PNG를 그대로 돌려줌", async () => {
    resetOgCacheForTest();
    let renders = 0;
    const card = async () => { renders++; return { kicker: "k", title: "테스트 주차장", lines: ["서울"], footer: "f" }; };
    const a = await ogImageCached("lot:1", card, 0);
    const b = await ogImageCached("lot:1", card, 1000);
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await b.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47])); // "PNG"
    expect(renders).toBe(1);
    expect(ogCacheStats).toEqual({ hits: 1, misses: 1 });
    await ogImageCached("lot:1", card, 3600_000);
    expect(renders).toBe(2); // 만료 후 다시 그림
  }, 30_000);
});

describe("언어 전환 요청 제한", () => {
  it("같은 클라이언트가 분당 30회를 넘기면 429", async () => {
    const { GET } = await import("@/app/lang/route");
    const req = () => new NextRequest("http://localhost/lang?to=en", { headers: { "x-forwarded-for": "198.51.100.77" } });
    for (let i = 0; i < 30; i++) expect(GET(req()).status).toBe(303);
    const r = GET(req());
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });
});

describe("보안 헤더", () => {
  it("운영에서만 HSTS, CSP는 외부 스크립트·연결 없음", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      const { vi } = await import("vitest"); vi.resetModules();
      const cfg = (await import("../next.config")).default;
      const all = (await cfg.headers!())[0].headers;
      const h = Object.fromEntries(all.map((x: { key: string; value: string }) => [x.key, x.value]));
      expect(h["Strict-Transport-Security"]).toBe("max-age=31536000");
      expect(h["Content-Security-Policy"]).toMatch(/script-src 'self' 'unsafe-inline';/);
      expect(h["Content-Security-Policy"]).toMatch(/connect-src 'self'/);
      expect(h["X-Frame-Options"]).toBe("DENY");
    } finally { env.NODE_ENV = saved; }
  });
});
