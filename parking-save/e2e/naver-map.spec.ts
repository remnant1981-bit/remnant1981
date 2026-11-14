// 네이버 지도 모드: 실제 SDK 대신 가짜 SDK를 가로채 넣어 우리 쪽 연결(불러오기·핀·묶기·인증 실패/로드 실패 시 OSM 대체·CSP)만 검증.
// ⚠ 실제 네이버 지도 동작·화면은 키 발급 후 확인 필요.
import { expect, test, type Page } from "@playwright/test";

const SEARCH = "/search?destination=%EC%84%9C%EC%9A%B8%EC%8B%9C%EC%B2%AD&start=2026-12-14T10:00&end=2026-12-14T12:00&radiusMeters=3000&view=map";

/** 공식 SDK에서 우리가 쓰는 부분만 흉내 낸 가짜 SDK. authFail이면 로드 직후 인증 실패 콜백을 부름 */
const fakeSdk = (authFail: boolean) => `(() => {
  const pins = [];
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  class LatLngBounds { constructor(a, b) { this.a = a; this.b = b; } extend() {} }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Map { constructor(el, o) { this.el = el; this.z = o.zoom; el.setAttribute("data-fake-map", "1"); }
    getZoom() { return this.z; } getMaxZoom() { return 21; } fitBounds() {} setCenter() {} setZoom(z) { this.z = z; } destroy() {}
    getProjection() { const s = 2 ** this.z * 256 / 360; return { fromCoordToOffset: (c) => ({ x: c.lng * s, y: -c.lat * s }), fromOffsetToCoord: (p) => new LatLng(-p.y / s, p.x / s) }; } }
  class Marker { constructor(o) { this.o = o; if (o.icon && o.icon.content) { const w = document.createElement("div"); w.className = "fake-pin"; w.appendChild(o.icon.content); o.map.el.appendChild(w); this.w = w; } }
    setMap(m) { if (!m && this.w) this.w.remove(); } }
  class Circle { constructor(o) { this.o = o; } setMap() {} }
  class InfoWindow { constructor() {} setContent() {} open() {} close() {} setMap() {} }
  const Event = { addListener: () => ({}), removeListener: () => {} };
  window.naver = { maps: { Map, LatLng, LatLngBounds, Point, Marker, Circle, InfoWindow, Event } };
  ${authFail ? "setTimeout(() => window.navermap_authFailure && window.navermap_authFailure(), 0);" : ""}
})();`;

async function routeSdk(page: Page, mode: "ok" | "auth-fail" | "load-fail") {
  const seen: string[] = [];
  await page.route("https://oapi.map.naver.com/**", (route) => {
    seen.push(route.request().url());
    if (mode === "load-fail") return route.abort();
    return route.fulfill({ contentType: "application/javascript", body: fakeSdk(mode === "auth-fail") });
  });
  return seen;
}

test("네이버 모드: SDK를 ncpKeyId로 불러와 요금 핀을 그림, CSP에 네이버 도메인 허용", async ({ page }) => {
  const seen = await routeSdk(page, "ok");
  const res = await page.goto(SEARCH);
  expect(res!.headers()["content-security-policy"]).toContain("https://oapi.map.naver.com");
  await expect(page.locator("[data-map-provider=naver][data-fake-map]")).toBeVisible();
  await expect(page.locator(".fake-pin").first()).toBeVisible();
  expect(await page.locator(".fake-pin").count()).toBeGreaterThan(0);
  expect(seen[0]).toContain("ncpKeyId=e2etestclient");
});

test("인증 실패 → OSM 지도로 대체", async ({ page }) => {
  await routeSdk(page, "auth-fail");
  await page.goto(SEARCH);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator("[data-map-provider=naver]")).toHaveCount(0);
});

test("SDK 로드 실패 → OSM 지도로 대체", async ({ page }) => {
  await routeSdk(page, "load-fail");
  await page.goto(SEARCH);
  await expect(page.locator(".leaflet-container")).toBeVisible();
});
