// 수집 실행: 활성화된 원천을 각각 독립 실행. mock + (BIZINFO_API_KEY 설정 시) 기업마당. docs/DATA_SOURCES.md.
import { createSqliteDb, migrate } from "../src/server/db";
import { runAll } from "../src/collector/runner";
import { configuredAdapters } from "../src/collector/registry";
import { generateNotifications } from "../src/server/userdata";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
console.log(JSON.stringify(await runAll(db, configuredAdapters()), null, 2));
console.log("notifications created:", await generateNotifications(db));
