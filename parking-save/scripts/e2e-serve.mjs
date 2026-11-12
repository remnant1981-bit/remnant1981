// E2E용 운영 빌드 실행: standalone 서버에 정적 파일·마이그레이션·글꼴을 복사하고 목업 데이터 DB로 띄운다.
// 사용: npm run build && node scripts/e2e-serve.mjs  (playwright.config.ts 의 webServer가 호출)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const sa = path.join(root, ".next/standalone");
if (!fs.existsSync(path.join(sa, "server.js"))) { console.error("먼저 npm run build"); process.exit(1); }
for (const [from, to] of [["public", "public"], [".next/static", ".next/static"], ["migrations", "migrations"], ["assets", "assets"]])
  fs.cpSync(path.join(root, from), path.join(sa, to), { recursive: true });
const db = path.join(root, "data/e2e.sqlite");
fs.mkdirSync(path.dirname(db), { recursive: true });
for (const f of [db, db + "-wal", db + "-shm"]) fs.rmSync(f, { force: true }); // 매번 새 DB(목업 자동 적재)
const port = process.env.E2E_PORT || "3100";
const child = spawn(process.execPath, ["server.js"], {
  cwd: sa, stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", PORT: port, HOSTNAME: "127.0.0.1", DATABASE_PATH: db, PARKING_MOCK_DATA: "true", SITE_URL: `http://127.0.0.1:${port}`,
    ADMIN_API_TOKEN: "e2e-token-0123456789abcdef0123456789abcdef", ADMIN_AUDIT_SALT: "e2e" },
});
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
child.on("exit", (c) => process.exit(c ?? 0));
