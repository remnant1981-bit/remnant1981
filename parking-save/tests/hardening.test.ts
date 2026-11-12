import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

let ip = "198.18.0.1";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": ip }), cookies: async () => ({ get: () => undefined }) }));

describe("보안 헤더(CSP)", () => {
  const cspFor = async (env: string) => {
    vi.resetModules(); vi.stubEnv("NODE_ENV", env);
    const cfg = (await import("../next.config")).default;
    const rules = await cfg.headers!();
    vi.unstubAllEnvs();
    return Object.fromEntries(rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  };
  it("운영: eval 금지, 프레임·객체·base·form 제한", async () => {
    const h = await cspFor("production");
    const csp = h["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
  });
  it("개발: Next 개발 서버용 eval만 추가 허용", async () => {
    expect((await cspFor("development"))["Content-Security-Policy"]).toContain("'unsafe-eval'");
  });
});

describe("화면 경로 요청 제한", () => {
  it("/search 화면: 61번째 요청부터 검색을 수행하지 않고 안내", async () => {
    vi.resetModules();
    const Page = (await import("@/app/search/page")).default;
    const { TooManyRequests } = await import("@/components/TooManyRequests");
    ip = "198.18.0.50";
    const sp = Promise.resolve({ destination: "서울시청", start: "2026-11-09T10:00", end: "2026-11-09T11:00" });
    let last: unknown;
    for (let i = 0; i < 60; i++) last = await Page({ searchParams: sp });
    expect((last as { type: unknown }).type).not.toBe(TooManyRequests);
    const blocked = (await Page({ searchParams: sp })) as { type: unknown; props: { retryAfterSec: number } };
    expect(blocked.type).toBe(TooManyRequests);
    expect(blocked.props.retryAfterSec).toBeGreaterThan(0);
    ip = "198.18.0.51";                               // 다른 클라이언트는 영향 없음
    expect(((await Page({ searchParams: sp })) as { type: unknown }).type).not.toBe(TooManyRequests);
  });
  it("안내 컴포넌트는 접근 가능한 alert", async () => {
    const { TooManyRequests } = await import("@/components/TooManyRequests");
    const html = renderToString(createElement(TooManyRequests, { retryAfterSec: 12 })).replace(/<!-- -->/g, ""); // React SSR이 텍스트 노드 사이에 넣는 주석 제거
    expect(html).toContain('role="alert"'); expect(html).toContain("12초");
  });
});

describe("오류 화면", () => {
  it("error.tsx: 내부 오류 메시지를 노출하지 않고 재시도 버튼 제공", async () => {
    const Err = (await import("@/app/error")).default;
    const html = renderToString(createElement(Err, { error: new Error("DB password=hunter2 at /srv/app"), reset: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("다시 시도");
    expect(html).not.toContain("hunter2"); expect(html).not.toContain("/srv/app");
  });
});
