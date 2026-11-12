// 접근성 회귀(axe-core, WCAG 2.1 A/AA): 주요 화면을 라이트·다크·영어로 점검. 자동 점검은 수동 점검을 대체하지 못함.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const P = "start=2026-12-14T10:00&end=2026-12-14T12:00";
const PAGES: Array<[string, string]> = [
  ["홈", "/"],
  ["검색 결과", `/search?destination=${encodeURIComponent("서울시청")}&${P}&radiusMeters=3000`],
  ["검색 입력 오류", `/search?destination=${encodeURIComponent("없는곳")}&${P}`],
  ["상세", "/lots/1?startAt=2026-12-14T10:00:00%2B09:00&endAt=2026-12-14T12:00:00%2B09:00"],
  ["비교", "/compare?ids=1,2,3&startAt=2026-12-14T10:00:00%2B09:00&endAt=2026-12-14T12:00:00%2B09:00&lat=37.5663&lng=126.9779"],
  ["지역 목록", "/area"],
  ["404", "/lots/9999"],
];

for (const [env, scheme, lang] of [["라이트", "light", ""], ["다크", "dark", ""], ["영어", "light", "en"]] as const) {
  test.describe(`접근성 ${env}`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, path] of PAGES) {
      test(name, async ({ page, context, baseURL }) => {
        if (lang) await context.addCookies([{ name: "ps-lang", value: lang, url: baseURL! }]);
        // 화면 요청 제한(클라이언트별 분당 60회)에 걸리지 않게 테스트마다 다른 클라이언트로
        await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.9.${env.length}.${name.length + path.length}` });
        await page.goto(path);
        await page.evaluate(axeSource);
        const r = await page.evaluate(() => (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
        expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
      });
    }
  });
}
