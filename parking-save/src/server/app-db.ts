import { getDb, type Db } from "./db";
import { ensureMockData, refreshMockOccupancy } from "./mock";
import { startUsageFlusher } from "./usage";

let ready: Promise<Db> | undefined;
/** 앱용 DB: 마이그레이션 + (활성 시) 목업 데이터 적재 */
export function getAppDb(): Promise<Db> {
  ready ??= (async () => { const db = await getDb(); await ensureMockData(db); startUsageFlusher(getAppDb); return db; })();
  return ready;
}
export function resetAppDbForTest() { ready = undefined; }
export { refreshMockOccupancy };
