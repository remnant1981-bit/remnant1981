// 사용: npm run sync -- --fixture tests/fixtures/standard-parking.sample.json
// 실제 원천 어댑터는 API 규격·인증 검증(OPEN_ISSUES #1, #2) 후 추가한다.
import { createSqliteDb, migrate } from "../src/server/db";
import { FixtureAdapter } from "../src/collector/fixture-adapter";
import { runSync } from "../src/collector/runner";

const i = process.argv.indexOf("--fixture");
if (i < 0 || !process.argv[i + 1]) { console.error("--fixture <file> 필요 (실제 원천 어댑터는 미구현)"); process.exit(2); }
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
console.log(await runSync(db, new FixtureAdapter("STANDARD_SAMPLE", process.argv[i + 1])));
