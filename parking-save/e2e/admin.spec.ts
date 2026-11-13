// 관리자 수동 보정 흐름: 접속 → 시설 번호로 보정 입력 → 상세 반영 → 되돌리기. (E2E 서버의 테스트용 토큰 사용)
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";

const TOKEN = "e2e-token-0123456789abcdef0123456789abcdef";
const DETAIL = "/lots/1?startAt=2026-12-14T10:00:00%2B09:00&endAt=2026-12-14T12:00:00%2B09:00";
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

test("요금 보정 적용 → 상세에 반영·표시 → 되돌리면 원래 요금", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "10.8.0.1" });
  await page.goto(DETAIL);
  const feeLine = page.locator("section[aria-labelledby=fee] p.text-lg");
  const before = await feeLine.innerText();

  await page.goto("/admin");
  await page.getByLabel(/관리자 토큰/).fill(TOKEN);
  await page.getByRole("button", { name: "접속" }).click();
  await page.getByLabel("처리자 이름").fill("E2E");
  await page.getByLabel("시설 번호").fill("1");
  await page.getByRole("button", { name: "보정 입력 열기" }).click();
  const ed = page.getByRole("group", { name: "시설 1 보정" });
  await expect(ed.getByText(/현재 요금:/)).toBeVisible();
  await ed.getByLabel("기본시간(분)").fill("60");
  await ed.getByLabel("기본요금(원)").fill("7000");
  await ed.getByLabel("추가 단위시간(분)").fill("60");
  await ed.getByLabel("추가요금(원)").fill("7000");
  // 근거 없이 적용하면 거부
  await ed.getByRole("button", { name: "보정 적용" }).click();
  await expect(ed.getByRole("alert")).toContainText("확인 근거");
  await ed.getByLabel(/확인 근거/).fill("E2E 테스트 입력");
  // 편집기 열린 상태 접근성
  await page.evaluate(axeSource);
  const ax = await page.evaluate(() => (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<{ violations: Array<{ id: string }> }> } }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
  expect(ax.violations.map((v) => v.id)).toEqual([]);
  await ed.getByRole("button", { name: "보정 적용" }).click();
  await expect(page.getByRole("status").first()).toContainText("보정을 적용했습니다");
  await expect(page.locator("section[aria-labelledby=ov-h] li").first()).toContainText("적용 중");

  await page.goto(DETAIL);
  await expect(feeLine).toHaveText("예상 14,000원"); // 2시간 = 7,000 + 7,000
  await expect(page.getByText(/관리자 보정 값입니다/)).toBeVisible();

  await page.goto("/admin");
  await page.getByLabel("처리자 이름").fill("E2E");
  await page.getByRole("button", { name: /되돌리기/ }).click();
  await expect(page.locator("section[aria-labelledby=ov-h] li").first()).toContainText("되돌림");
  await page.goto(DETAIL);
  await expect(feeLine).toHaveText(before);
  await expect(page.getByText(/관리자 보정 값입니다/)).toHaveCount(0);
});
