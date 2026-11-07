// 백업/복구: node scripts/backup.ts backup <out.sqlite> | restore <in.sqlite>
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [cmd, file] = process.argv.slice(2);
const src = process.env.DATABASE_PATH || "./data/dev.sqlite";
if (cmd === "backup" && file) {
  if (fs.existsSync(file)) throw new Error("대상 파일이 이미 존재합니다: " + file);
  new DatabaseSync(src).exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log("backup ok ->", file);
} else if (cmd === "restore" && file) {
  const chk = new DatabaseSync(file, { readOnly: true });
  const r = chk.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (r.integrity_check !== "ok") throw new Error("백업 무결성 검사 실패");
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(src + s, { force: true });
  fs.copyFileSync(file, src);
  console.log("restore ok ->", src);
} else console.log("usage: backup <out> | restore <in>");
