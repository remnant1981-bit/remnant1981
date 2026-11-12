// 사용: npm run reports                                 → 검토 대기 신고 목록
//       npm run reports -- reviewed <id> --by <이름>     → 확인 처리(원천 수정은 별도)
//       npm run reports -- dismiss <id> --by <이름>      → 기각
import { createSqliteDb, migrate } from "../src/server/db";
import { REPORT_CATEGORIES, decideReport, listReports } from "../src/server/reports";

const [cmd, idArg] = process.argv.slice(2);
const byIdx = process.argv.indexOf("--by");
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
if (!cmd) {
  const list = await listReports(db);
  if (list.length === 0) console.log("검토 대기 신고 없음");
  for (const r of list) console.log(`#${r.id} ${r.created_at.slice(0, 16)} [${REPORT_CATEGORIES[r.category]}] 시설 ${r.parking_lot_id} ${r.name}\n   ${r.message ?? "(내용 없음)"}`);
} else if ((cmd === "reviewed" || cmd === "dismiss") && /^\d+$/.test(idArg ?? "") && byIdx > 0 && process.argv[byIdx + 1]) {
  const ok = await decideReport(db, Number(idArg), cmd === "reviewed" ? "REVIEWED" : "DISMISSED", process.argv[byIdx + 1]);
  console.log(ok ? `신고 #${idArg} 처리 완료` : `신고 #${idArg}는 대기 상태가 아니거나 없습니다.`);
  process.exit(ok ? 0 : 1);
} else { console.error("사용법: reports [reviewed|dismiss <id> --by <이름>]"); process.exit(2); }
