// 정기 수집용 스크립트: 활성화된 원천을 각각 독립 실행하고 알림을 생성한다.
// 종료 코드: 0=모두 성공, 1=일부/전체 실패(스케줄러에서 실패 감지용). 키·URL은 출력하지 않는다.
// 실행 환경 변수: DATABASE_PATH, BIZINFO_API_KEY, DATA_GO_KR_API_KEY(K-Startup) (기업마당은 해외 IP 차단 → 국내 IP 환경에서 실행)
import { createSqliteDb, migrate } from "../src/server/db";
import { runAll } from "../src/collector/runner";
import { configuredAdapters } from "../src/collector/registry";
import { generateNotifications } from "../src/server/userdata";

const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const results = await runAll(db, configuredAdapters());
const stamp = new Date().toISOString();
for (const r of results) {
  console.log(`[${stamp}] ${r.source}: ${r.status} fetched=${r.fetched} inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped}${r.errors.length ? " errors=" + r.errors.slice(0, 3).join(" | ") : ""}`);
}
if (results.length === 0) console.log(`[${stamp}] 실행할 원천이 없습니다(관리자 화면에서 원천을 활성화하고 필요한 키를 설정하세요).`);
console.log(`[${stamp}] notifications created: ${await generateNotifications(db)}`);
process.exit(results.some((r) => r.status !== "success") ? 1 : 0);
