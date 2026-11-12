// E2E(주요 흐름 + 접근성). 목업 데이터로 운영 빌드를 띄워 실행한다: npm run build && npm run e2e
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT || "3100";
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false, // 화면 요청 제한(분당 60회/클라이언트)과 공유 DB 때문에 순차 실행
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", ...devices["Pixel 7"], locale: "ko-KR", timezoneId: "Asia/Seoul" },
  webServer: { command: "node scripts/e2e-serve.mjs", url: `http://127.0.0.1:${PORT}/api/health`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
