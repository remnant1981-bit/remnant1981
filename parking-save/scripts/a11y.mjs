// 접근성 자동 점검(axe-core, WCAG 2.1 A/AA). 앱이 떠 있어야 함: BASE_URL=http://localhost:3000 node scripts/a11y.mjs
// playwright는 프로젝트 의존성이 아니므로 별도 설치/NODE_PATH 필요(CI 미포함). 자동 점검은 수동 점검(스크린리더 등)을 대체하지 못함.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const P = "start=2026-11-09T10:00&end=2026-11-09T12:00";
const PAGES = [
  ["홈", "/"],
  ["검색 결과", `/search?destination=${encodeURIComponent("서울시청")}&${P}&radiusMeters=3000`],
  ["검색 결과(지도)", `/search?destination=${encodeURIComponent("서울시청")}&${P}&radiusMeters=3000&view=map`],
  ["검색 빈 결과", `/search?lat=35.1&lng=129.0&${P}`],
  ["검색 입력 오류", `/search?destination=${encodeURIComponent("없는곳")}&${P}`],
  ["상세(요금 계산)", "/lots/1?startAt=2026-11-09T10:00:00%2B09:00&endAt=2026-11-09T12:00:00%2B09:00&destLat=37.5663&destLng=126.9779&destName=%EC%84%9C%EC%9A%B8%EC%8B%9C%EC%B2%AD"],
  ["상세(정보 없음)", "/lots/4?startAt=2026-11-09T10:00:00%2B09:00&endAt=2026-11-09T12:00:00%2B09:00"],
  ["상세(주차 타이머 진행)", "/lots/1?startAt=2026-11-09T10:00:00%2B09:00&endAt=2026-11-09T12:00:00%2B09:00", async (page) => { const b = page.getByRole("button", { name: /여기 주차 시작|Start parking here/ }); if (await b.count()) await b.click(); await page.waitForTimeout(300); }],
  ["홈(즐겨찾기·최근 검색·타이머)", "/"],
  ["오프라인 안내", "/offline"],
  ["이용약관", "/terms"],
  ["관리자(로그인)", "/admin"],
  ["주차장 비교", "/compare?ids=1,2,3&startAt=2026-11-09T10:00:00%2B09:00&endAt=2026-11-09T12:00:00%2B09:00&lat=37.5663&lng=126.9779"],
  ["개인정보·위치정보 처리방침", "/privacy"],
  ["상세(오류 신고 열기)", "/lots/1?startAt=2026-11-09T17:00:00%2B09:00&endAt=2026-11-09T19:00:00%2B09:00", async (page) => { await page.getByText(/정보가 틀렸나요\? 알려 주세요|Is this information wrong\? Tell us/).click(); }],
  ["404", "/lots/9999"],
];
const browser = await chromium.launch();
let total = 0;
// 마지막 환경은 영어 화면(언어 쿠키). 약관·처리방침·관리자는 한국어만 제공
for (const [vpName, viewport, colorScheme, lang] of [["모바일 390px", { width: 390, height: 844 }, "light"], ["데스크톱 1280px", { width: 1280, height: 800 }, "light"], ["모바일 다크", { width: 390, height: 844 }, "dark"], ["모바일 영어", { width: 390, height: 844 }, "light", "en"]]) {
  const ctx = await browser.newContext({ viewport, colorScheme });
  if (lang) await ctx.addCookies([{ name: "ps-lang", value: lang, url: BASE }]);
  const page = await ctx.newPage();
  for (const [name, path, act] of PAGES) {
    await page.goto(BASE + path);
    if (act) await act(page);
    await page.evaluate(axeSource);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    total += res.violations.length;
    console.log(`[${vpName}] ${name}: 위반 ${res.violations.length}건 (통과 규칙 ${res.passes.length})`);
    for (const v of res.violations) console.log(`   - ${v.id} (${v.impact}): ${v.help} → ${v.nodes.length}곳 예) ${v.nodes[0].target.join(" ")}`);
  }
}
await browser.close();
process.exit(total ? 1 : 0);
