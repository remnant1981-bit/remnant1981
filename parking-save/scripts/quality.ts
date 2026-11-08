// 사용: npm run quality   (읽기 전용 데이터 품질·운영 점검 리포트, JSON 출력)
import { createSqliteDb, migrate } from "../src/server/db";
import { buildQualityReport } from "../src/server/quality";

const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const r = await buildQualityReport(db);
console.log(JSON.stringify(r, null, 1));
process.exit(r.alerts.some((a) => a.level === "ERROR") ? 1 : 0); // 오류 수준 알림이 있으면 비정상 종료(스케줄러/CI 연동용)
