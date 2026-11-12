// 주요 흐름 회귀: 검색 → 결과 → 상세(요금) → 비교 → 언어 전환. 목업 데이터(가상 주차장) 기준.
import { expect, test } from "@playwright/test";

// 목업 공휴일 커버리지(2026-11~12) 안의 평일 — 실행 날짜와 무관하게 같은 결과
const Q = "destination=%EC%84%9C%EC%9A%B8%EC%8B%9C%EC%B2%AD&start=2026-12-14T10:00&end=2026-12-14T12:00&radiusMeters=3000";

test("홈에서 목적지로 검색하면 결과 카드와 요금이 보임", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "파킹세이브" })).toBeVisible();
  await page.getByLabel("목적지").fill("서울시청");
  await page.getByLabel("시작 일시").fill("2026-12-14T10:00");
  await page.getByLabel("종료 일시").fill("2026-12-14T12:00");
  await page.getByRole("button", { name: "주차장 검색" }).click();
  await expect(page).toHaveURL(/\/search\?/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("서울시청");
  const cards = page.locator("main li h2");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(3);
  // 요금 정보 없는 시설을 무료로 보이지 않음
  await expect(page.locator("main li", { hasText: "요금·면수 정보 없음" }).getByText("요금 정보 없음")).toBeVisible();
});

test("상세: 예상 요금·요금 규칙·운영시간·출처", async ({ page }) => {
  await page.goto(`/search?${Q}`);
  await page.locator("main li h2 a", { hasText: "시청앞 노외 A" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("시청앞 노외 A");
  await expect(page.getByRole("heading", { name: "예상 요금" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=fee] p.text-lg")).toHaveText(/예상 [\d,]+원|무료/);
  await expect(page.getByRole("heading", { name: "운영시간" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "데이터 출처" })).toBeVisible();
});

test("비교: 두 곳 담아 나란히 비교표", async ({ page }) => {
  await page.goto(`/search?${Q}`);
  const toggles = page.locator('main li button[aria-pressed]', { hasText: "비교" });
  await toggles.nth(0).click();
  await toggles.nth(1).click();
  await page.getByRole("link", { name: "나란히 비교" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "주차장 비교" })).toBeVisible();
  await expect(page.locator("thead th")).toHaveCount(3);
  await expect(page.getByRole("rowheader", { name: "예상 요금" })).toBeVisible();
});

test("영어 전환: 같은 화면 유지, 한국어로 복귀", async ({ page }) => {
  await page.goto(`/search?${Q}`);
  await page.getByRole("link", { name: /English/ }).click();
  await expect(page).toHaveURL(/\/search\?.*destination=/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Parking near");
  await page.getByRole("link", { name: /한국어/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("검색 엔진용 경로: robots·sitemap·지역 목록·공유 이미지", async ({ request, page }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /search");
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  const og = await request.get("/opengraph-image");
  expect(og.headers()["content-type"]).toContain("image/png");
  await page.goto("/area");
  await expect(page.getByRole("heading", { level: 1, name: "지역별 공영주차장" })).toBeVisible();
});

test("헬스체크·관리자 API 보호", async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  expect(["ok", "degraded"]).toContain(h.status);
  expect((await request.get("/api/admin/db-check")).status()).toBe(401);
});
