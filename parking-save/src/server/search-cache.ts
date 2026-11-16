// 검색 결과 단기 캐시(메모리, 30초). 같은 조건의 반복 요청(공유 링크·지역 페이지의 '이 지역에서 검색'·새로고침·목록/지도 전환)에서 DB 조회와 요금 계산을 건너뛴다.
// - 키에 검색 좌표가 들어가지만 메모리에만 30초 머물고 기록·저장하지 않는다(요청 처리 중 메모리에 있는 것과 같은 수준).
// - 30초 안의 변경(수집·관리자 보정·실시간 잔여면수)은 최대 30초 늦게 보인다. 실시간 신선도 기준(10~20분)에 비해 충분히 짧다.
// - 목업 모드는 요청마다 가상 잔여면수를 갱신하므로 캐시하지 않는다. 서버 1대 전제(프로세스 메모리).
import type { Db } from "./db";
import { mockEnabled } from "./mock";
import { searchLots, type SearchParams, type SearchResponse } from "./search";
import { countUsage } from "./usage";

export const SEARCH_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { at: number; res: Promise<SearchResponse> }>();
export const searchCacheStats = { hits: 0, misses: 0 };

export function searchCacheKey(p: SearchParams): string {
  return [p.center.lat.toFixed(4), p.center.lng.toFixed(4), p.centerKind, p.centerLabel, p.radiusMeters, p.startAt.getTime(), p.endAt.getTime(), p.sort, p.type,
    +p.freeOnly, +p.realtimeOnly, +p.operatingOnly, p.limit, p.lang ?? "ko", p.place ? `${p.place.region}|${p.place.matches}|${p.place.otherRegions.join(",")}` : ""].join("\u0001");
}

export async function searchLotsCached(db: Db, p: SearchParams, now = new Date()): Promise<SearchResponse> {
  if (mockEnabled()) return searchLots(db, p, now);
  const key = searchCacheKey(p), t = now.getTime();
  const hit = cache.get(key);
  if (hit && t - hit.at < SEARCH_CACHE_TTL_MS) { searchCacheStats.hits++; countUsage("search_cache_hit", t); return hit.res; }
  searchCacheStats.misses++;
  // 진행 중인 계산도 공유(같은 조건 동시 요청이 몰릴 때 한 번만 계산). 실패하면 캐시에서 제거
  const res = searchLots(db, p, now);
  cache.set(key, { at: t, res });
  res.catch(() => { if (cache.get(key)?.res === res) cache.delete(key); });
  if (cache.size > MAX_ENTRIES) { // 오래된 것부터 정리(Map은 넣은 순서 유지)
    for (const [k, v] of cache) { if (cache.size <= MAX_ENTRIES * 0.8 && t - v.at < SEARCH_CACHE_TTL_MS) break; cache.delete(k); }
  }
  return res;
}
export function resetSearchCacheForTest() { cache.clear(); searchCacheStats.hits = 0; searchCacheStats.misses = 0; }
