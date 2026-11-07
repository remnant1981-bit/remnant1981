import { createSqliteDb, migrate } from "../src/server/db";
import { seedAll } from "../src/server/bootstrap";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const r = await seedAll(db, { adminEmail: "admin@example.test", adminPassword: process.env.SEED_ADMIN_PASSWORD });
console.log("seeded. 관리자: admin@example.test", r.adminPassword && !process.env.SEED_ADMIN_PASSWORD ? `임시 비밀번호(1회 표시): ${r.adminPassword}` : "(기존 계정 유지)");
