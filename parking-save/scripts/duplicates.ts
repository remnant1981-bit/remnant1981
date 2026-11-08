// 사용: npm run duplicates                      → 검토 대기 후보 목록
//       npm run duplicates -- approve <id> --by <이름>   → '동일 시설'로 승인(레코드 병합 없이 연결)
//       npm run duplicates -- reject <id> --by <이름>
import { createSqliteDb, migrate } from "../src/server/db";
import { decide, listPending } from "../src/server/duplicates";

const [cmd, idArg] = process.argv.slice(2);
const byIdx = process.argv.indexOf("--by");
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
if (!cmd) {
  const list = await listPending(db);
  if (list.length === 0) console.log("검토 대기 후보 없음");
  for (const c of list) console.log(`#${c.id} (점수 ${c.score}) ${c.reason}\n   A[${c.a.source}] ${c.a.name} | ${c.a.address ?? "-"} | ${c.a.totalSpaces ?? "-"}면\n   B[${c.b.source}] ${c.b.name} | ${c.b.address ?? "-"} | ${c.b.totalSpaces ?? "-"}면`);
} else if ((cmd === "approve" || cmd === "reject") && /^\d+$/.test(idArg ?? "") && byIdx > 0 && process.argv[byIdx + 1]) {
  const ok = await decide(db, Number(idArg), cmd === "approve" ? "MERGED" : "REJECTED", process.argv[byIdx + 1]);
  console.log(ok ? `후보 #${idArg} ${cmd === "approve" ? "승인(연결)" : "거절"} 완료` : `후보 #${idArg}는 대기 상태가 아니거나 없습니다.`);
  process.exit(ok ? 0 : 1);
} else { console.error("사용법: duplicates [approve|reject <id> --by <이름>]"); process.exit(2); }
