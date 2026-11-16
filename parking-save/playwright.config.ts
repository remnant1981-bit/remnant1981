// E2E(주요 흐름 + 접근성). 목업 데이터로 운영 빌드를 띄워 실행한다: npm run build && npm run e2e
// 서버 2대: 기본(OSM 지도) + 네이버 지도 모드(가짜 SDK로 연결만 검증 — 실제 키 없음)
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT || "3100";
const NAVER_PORT = "3101";
const common = { trace: "off" as const, ...devices["Pixel 7"], locale: "ko-KR", timezoneId: "Asia/Seoul" };
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false, // 화면 요청 제한(분당 60회/클라이언트)과 공유 DB 때문에 순차 실행
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  projects: [
    { name: "default", testIgnore: /naver-map\.spec\.ts/, use: { ...common, baseURL: `http://127.0.0.1:${PORT}` } },
    { name: "naver", testMatch: /naver-map\.spec\.ts/, use: { ...common, baseURL: `http://127.0.0.1:${NAVER_PORT}` } },
  ],
  webServer: [
    { command: "node scripts/e2e-serve.mjs", url: `http://127.0.0.1:${PORT}/api/health`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: "node scripts/e2e-serve.mjs", url: `http://127.0.0.1:${NAVER_PORT}/api/health`, reuseExistingServer: !process.env.CI, timeout: 60_000,
      env: { E2E_PORT: NAVER_PORT, MAP_TILE_PROVIDER: "naver", NAVER_MAP_CLIENT_ID: "e2etestclient" } },
  ],
});
