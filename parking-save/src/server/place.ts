// 목적지 검색(무료·외부 API 없음): 보유한 주차장 이름·주소에서 입력어를 찾아 그 주차장들 가운데(중앙값에 가장 가까운 주차장 위치)를 검색 중심으로 쓴다.
// 정식 지오코딩이 아니다 — 건물·상호는 못 찾고, 동·도로명·시설명처럼 주차장 주소에 나오는 말만 찾는다. 화면에 '주차장 주소 기준 대략 위치'로 표시.
// 여러 지역에 같은 이름이 있으면 일치가 가장 많은 시·군·구를 고르고, 다른 후보 지역을 함께 알려 준다(임의로 하나를 정답처럼 보이지 않게).
import type { Db } from "./db";
import { regionOf } from "@/domain/region";
import { NON_PRODUCTION_SOURCES, mockEnabled } from "./mock";

export interface ResolvedPlace { lat: number; lng: number; label: string; region: string; matches: number; otherRegions: string[] }
export const PLACE_MIN_LEN = 2;
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function resolveDestination(db: Db, text: string): Promise<ResolvedPlace | null> {
  const tokens = text.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (tokens.length === 0 || tokens.join("").length < PLACE_MIN_LEN || tokens.join(" ").length > 100) return null;
  const excluded = mockEnabled() ? [] : NON_PRODUCTION_SOURCES;
  const cond = tokens.map(() => "(name LIKE ? ESCAPE '\\' OR road_address LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\')").join(" AND ");
  const args: Array<string | number> = tokens.flatMap((t) => { const p = `%${esc(t)}%`; return [p, p, p]; });
  const rows = await db.all<{ latitude: number; longitude: number; road_address: string | null; address: string | null }>(
    `SELECT latitude, longitude, road_address, address FROM parking_lots
     WHERE data_status NOT LIKE 'EXCLUDED%' AND latitude IS NOT NULL AND longitude IS NOT NULL AND ${cond}
     ${excluded.length ? `AND source_name NOT IN (${excluded.map(() => "?").join(",")})` : ""} LIMIT 2000`, [...args, ...excluded]);
  if (rows.length === 0) return null;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = regionOf(r.road_address) ?? regionOf(r.address);
    const k = g ? (g.sido === g.sigungu ? g.sido : `${g.sido} ${g.sigungu}`) : "";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  // 지역을 알 수 있는 묶음 우선, 일치 수 많은 순(같으면 이름순 — 결과가 실행마다 바뀌지 않게)
  const ranked = [...groups].sort((a, b) => Number(b[0] !== "") - Number(a[0] !== "") || b[1].length - a[1].length || a[0].localeCompare(b[0], "ko"));
  const [region, list] = ranked[0];
  // 중앙값 지점에 가장 가까운 '실제 일치 주차장' 위치를 중심으로(흩어진 경우에도 중심이 빈 곳에 떨어지지 않게)
  const mLat = median(list.map((r) => r.latitude)), mLng = median(list.map((r) => r.longitude));
  const c = list.reduce((best, r) => (Math.hypot(r.latitude - mLat, (r.longitude - mLng) * 0.8) < Math.hypot(best.latitude - mLat, (best.longitude - mLng) * 0.8) ? r : best));
  return {
    lat: Number(c.latitude.toFixed(4)), lng: Number(c.longitude.toFixed(4)),
    label: text.trim().replace(/\s+/g, " "), region, matches: list.length,
    otherRegions: ranked.slice(1).map(([k]) => k).filter(Boolean).slice(0, 5),
  };
}
