/**
 * 데모 모드: 실제 DB(data/dev.sqlite)와 분리된 data/demo.sqlite 에 테스트 데이터·데모 계정을 만들고 개발 서버를 띄운다.
 *   npm run demo            → 데모 DB 새로 만들고 실행(이전 데모 변경사항 초기화)
 *   npm run demo -- --keep  → 기존 데모 DB 유지하고 실행
 * 모든 공고는 '테스트 데이터'(모의 원천)이며 외부 API를 호출하지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DB_PATH = path.resolve("data/demo.sqlite");
const PORT = process.env.PORT || "3000";
export const DEMO_USER = { email: "demo@demo.test", password: "DemoUser12345" };
export const DEMO_ADMIN = { email: "admin@demo.test", password: "DemoAdmin12345" };

process.env.DATABASE_PATH = DB_PATH;
process.env.DEV_AUTO_APPROVE_COMPANY = "true";
process.env.DEMO_MODE = "true";
process.env.PLANS_ENABLED ??= "true"; // 무료 한도(진행 관리 3건)까지 체험
process.env.BCRYPT_COST ??= "10";
// 데모 전용 키(운영 키와 섞이지 않도록 항상 덮어씀)
process.env.APP_HMAC_KEY = "demo-only-hmac-key-not-for-production";
process.env.APP_ENCRYPTION_KEY = "demo-only-encryption-key-not-for-production";
process.env.APP_SESSION_PEPPER = "demo-only-session-pepper-not-for-production";

const keep = process.argv.includes("--keep") && fs.existsSync(DB_PATH);

if (!keep) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB_PATH + s, { force: true });

  const { createSqliteDb, migrate } = await import("../src/server/db");
  const { seedAll } = await import("../src/server/bootstrap");
  const { runSource } = await import("../src/collector/runner");
  const { register } = await import("../src/server/auth");
  const { requestCompanyClaim, saveCompanyProfile } = await import("../src/server/company");
  const { savePipelineItem, addPipelineNote } = await import("../src/server/pipeline");
  const { seoulToday } = await import("../src/lib/time");

  const db = await createSqliteDb(DB_PATH);
  await migrate(db);
  await seedAll(db, { adminEmail: DEMO_ADMIN.email, adminPassword: DEMO_ADMIN.password, withMock: true });

  // 추가 테스트 공고(지역·분야·마감일 다양화) — 모의 원천이므로 화면에 '테스트 데이터'로 표시됨
  const today = seoulToday();
  const day = (d: number) => new Date(Date.parse(today + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
  const SIDO = ["서울특별시", "경기도", "부산광역시", "대구광역시", "인천광역시", "충청남도", "경상북도", "경상남도", "전북특별자치도", "강원특별자치도"];
  const CITY: Record<string, string[]> = { 경기도: ["시흥시", "안산시", "안성시", "파주시", "화성시"], 경상북도: ["포항시", "구미시"], 경상남도: ["창원시", "거제시"] };
  const TOPIC: [string, string[]][] = [
    ["수소 연료전지 핵심부품 기술개발", ["rnd"]], ["액화수소 저장·운송 기자재 실증", ["rnd", "commercialization"]],
    ["조선·해양기자재 사업화 지원", ["commercialization"]], ["스마트공장 구축 지원", ["commercialization"]],
    ["6G 이동통신 실증", ["rnd"]], ["친환경 농산물 판로 지원", ["marketing"]], ["AI 콘텐츠 제작 지원", ["commercialization"]],
    ["수출바우처", ["export"]], ["정책자금 융자", ["finance"]], ["청년 인력 채용 장려금", ["hr"]],
    ["반도체 장비 국산화", ["rnd"]], ["전시회 참가 판로개척", ["marketing"]],
  ];
  const items = Array.from({ length: 240 }, (_, i) => {
    const nat = i % 3 === 0;
    const sido = SIDO[i % SIDO.length];
    const city = !nat && CITY[sido] ? CITY[sido][i % CITY[sido].length] : "";
    const [topic, cats] = TOPIC[i % TOPIC.length];
    const end = i % 9 === 0 ? day(2) : i % 4 === 0 ? day(6) : i % 11 === 0 ? day(-3) : day(20 + (i % 30));
    return {
      sourceNoticeId: `DEMO-${i}`, url: `https://example.org/demo-notice/${i}`,
      title: `[테스트] ${nat ? "" : `${city || sido} `}2026년 ${topic} ${Math.floor(i / TOPIC.length) + 1}차`,
      organization: `테스트 지원기관 ${i % 15}`, categories: cats, regionScope: nat ? "전국" : sido,
      targetSummary: i % 7 === 0 ? "소상공인" : i % 5 === 0 ? "창업 7년 이내 중소기업" : "중소기업",
      supportSummary: `${topic} 비용 일부 지원(테스트)`, applicationStart: day(-10 + (i % 5)), applicationEnd: end,
      originalText: "이 공고는 데모용 테스트 데이터입니다. 실제 공고가 아닙니다.",
    };
  });
  await runSource(db, { sourceId: "mock", fetch: async () => items });

  // 데모 기업 계정
  const r = await register(db, DEMO_USER.email, DEMO_USER.password, "demo");
  if (!r.created) throw new Error("데모 계정 생성 실패");
  await requestCompanyClaim(db, r.userId, "1234567891");
  await saveCompanyProfile(db, r.userId, {
    company_name: "(데모) 수소·조선 부품 제조기업", region_sido: "경기도", region_sigungu: "시흥시", industry_group: "제조업",
    tech_fields: "수소·에너지,조선·해양", enterprise_size: "중소기업", established_at: "2015-03-01", interest_categories: "rnd,commercialization",
  });

  // 진행 관리 예시 2건(무료 한도 3건 중 1건 남김)
  const pick = async (like: string) => (await db.get<{ id: string }>(
    "SELECT id FROM announcements WHERE title LIKE ? AND application_end>=? ORDER BY application_end LIMIT 1", [like, day(3)]))?.id;
  const a1 = await pick("%액화수소%"), a2 = await pick("%시흥시%");
  if (a1) {
    await savePipelineItem(db, r.userId, { announcementId: a1, stage: "preparing", targetDate: day(10) });
    await addPipelineNote(db, r.userId, { announcementId: a1, body: "담당기관 문의 완료 — 사업계획서 초안 작성 중(데모 메모)" });
  }
  if (a2) await savePipelineItem(db, r.userId, { announcementId: a2, stage: "reviewing" });
  console.log("데모 DB 준비 완료:", DB_PATH);
} else {
  console.log("기존 데모 DB 사용:", DB_PATH);
}

console.log(`
──────────────────────────────────────────────
 GovBiz Finder 데모 모드  →  http://localhost:${PORT}
 기업 계정  : ${DEMO_USER.email} / ${DEMO_USER.password}
 관리자     : ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}
 모든 공고는 테스트 데이터. 실제 DB(dev.sqlite)는 건드리지 않음.
 종료: Ctrl+C
──────────────────────────────────────────────`);

const nextBin = path.resolve("node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", PORT], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
