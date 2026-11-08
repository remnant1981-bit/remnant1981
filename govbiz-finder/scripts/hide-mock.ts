// 테스트(모의) 데이터를 숨긴다: mock 원천 비활성화 + mock 공고 비활성(검색·상세·내보내기에서 제외).
// 실제 공고 원천만 쓰려는 환경에서 한 번 실행. 되돌리려면 관리자 화면에서 원천/공고를 다시 활성화.
import { createSqliteDb, migrate } from "../src/server/db";
const db = await createSqliteDb(process.env.DATABASE_PATH || "./data/dev.sqlite");
await migrate(db);
const a = await db.run("UPDATE announcements SET is_active=0 WHERE source_id='mock'");
const s = await db.run("UPDATE data_sources SET enabled=0 WHERE id='mock'");
console.log(`테스트 공고 ${a.changes}건 비활성화, mock 원천 ${s.changes ? "비활성화" : "변경 없음"}`);
