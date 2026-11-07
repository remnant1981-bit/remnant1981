// 사용: DATA_GO_KR_SERVICE_KEY=... npm run sync:holidays
// ⚠ 공휴일 오퍼레이션 응답은 실키로 아직 검증되지 않음(docs/OPEN_ISSUES.md #4). 첫 실행 결과를 반드시 육안 검증.
import { createSqliteDb, migrate } from "../src/server/db";
import { kasiMonthFetcher, syncHolidays } from "../src/collector/holidays";

const key = process.env.DATA_GO_KR_SERVICE_KEY;
if (!key) { console.error("DATA_GO_KR_SERVICE_KEY 환경변수가 필요합니다."); process.exit(2); }
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
console.log(JSON.stringify(await syncHolidays(db, kasiMonthFetcher({ serviceKey: key })), null, 1));
