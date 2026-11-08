// 사용: SEOUL_OPENAPI_KEY=... npm run sync:seoul   (서울 열린데이터광장 인증키. 환경변수로만 전달)
// ⚠ 문서 예시는 http이며 키가 URL 경로에 들어간다. SEOUL_OPENAPI_BASE로 https 엔드포인트 지정 가능(지원 여부 미확인).
import { createSqliteDb, migrate } from "../src/server/db";
import { SEOUL_DEFAULT_BASE, seoulPageFetcher, syncSeoulOccupancy } from "../src/collector/seoul-sync";

const key = process.env.SEOUL_OPENAPI_KEY;
if (!key) { console.error("SEOUL_OPENAPI_KEY 환경변수가 필요합니다."); process.exit(2); }
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const r = await syncSeoulOccupancy(db, seoulPageFetcher({ key, baseUrl: process.env.SEOUL_OPENAPI_BASE || SEOUL_DEFAULT_BASE }));
console.log(JSON.stringify(r, null, 1));
process.exit(r.status === "FAILED" ? 1 : 0);
