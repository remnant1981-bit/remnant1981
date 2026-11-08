import { createSqliteDb, migrate } from "../src/server/db";
import { seedAll } from "../src/server/bootstrap";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.test";
const r = await seedAll(db, { adminEmail, adminPassword: process.env.SEED_ADMIN_PASSWORD, withMock: process.env.SEED_WITH_MOCK !== "false" });
console.log(`seeded. 관리자: ${adminEmail}`, r.adminPassword && !process.env.SEED_ADMIN_PASSWORD ? `임시 비밀번호(1회 표시): ${r.adminPassword}` : "(기존 계정 유지)");
if (process.env.SEED_WITH_MOCK === "false") {
  // 운영: 테스트(모의) 원천은 끄고, 키가 있으면 기업마당 수집을 켠다
  await db.run("UPDATE data_sources SET enabled=0 WHERE id='mock'");
  await db.run("UPDATE announcements SET is_active=0 WHERE source_id='mock'");
  if (process.env.BIZINFO_API_KEY) await db.run("UPDATE data_sources SET enabled=1 WHERE id='bizinfo'");
  console.log("운영 시드: 모의 원천 비활성", process.env.BIZINFO_API_KEY ? "· 기업마당 수집 활성" : "· 기업마당 키 없음(수집 비활성)");
}
