// 사용: npm run profile [-- <source_name>]   기본 DATA_GO_KR_15012896 (표준데이터 API). 샘플 확인은 STANDARD_SAMPLE.
import { createSqliteDb, migrate } from "../src/server/db";
import { profileStandardSource } from "../src/server/profile";

const source = process.argv[2] || "DATA_GO_KR_15012896";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
console.log(JSON.stringify(await profileStandardSource(db, source), null, 1));
