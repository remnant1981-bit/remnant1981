// 수집 실행: 활성화된 원천을 각각 독립 실행. 현재 구현된 어댑터는 mock 뿐(실 원천은 미연동, docs/DATA_SOURCES.md).
import { createSqliteDb, migrate } from "../src/server/db";
import { runAll } from "../src/collector/runner";
import { MockAdapter } from "../src/collector/mock-adapter";
import { seoulToday } from "../src/lib/time";
import { generateNotifications } from "../src/server/userdata";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
console.log(JSON.stringify(await runAll(db, [new MockAdapter(seoulToday())]), null, 2));
console.log("notifications created:", await generateNotifications(db));
