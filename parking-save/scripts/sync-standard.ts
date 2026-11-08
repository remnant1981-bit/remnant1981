// 사용: DATA_GO_KR_SERVICE_KEY=... npm run sync:standard
// ⚠ 응답 봉투·페이지 크기·값 분포는 실키로 아직 검증되지 않음(docs/OPEN_ISSUES.md #1). 첫 실행 결과를 `npm run quality`로 점검할 것.
import { createSqliteDb, migrate } from "../src/server/db";
import { StandardApiAdapter, standardPageFetcher } from "../src/collector/standard-api";
import { runSync } from "../src/collector/runner";

const key = process.env.DATA_GO_KR_SERVICE_KEY;
if (!key) { console.error("DATA_GO_KR_SERVICE_KEY 환경변수가 필요합니다."); process.exit(2); }
const pageSize = Number(process.env.STANDARD_PAGE_SIZE) || 100;
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const r = await runSync(db, new StandardApiAdapter(standardPageFetcher({ serviceKey: key }), pageSize));
console.log(JSON.stringify(r, null, 1));
process.exit(r.status === "FAILED" ? 1 : 0);
