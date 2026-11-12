// 지역별 공영주차장 목록(검색 엔진·공유용 정적 성격 페이지). 실서비스 원천만, 제외 시설 빼고, 주소로 지역 판별.
// 요금은 '대표 요금' 요약(평일/매일 기본요금·일 최대)만 — 시간 입력 계산은 상세·검색 화면에서. 규칙이 없으면 '요금 정보 없음'(무료 아님).
import type { Db } from "./db";
import { regionOf, type Region } from "@/domain/region";
import { NON_PRODUCTION_SOURCES, mockEnabled } from "./mock";

export interface FeeSummary { kind: "FREE" | "PAID" | "UNKNOWN"; base: { minutes: number; amount: number } | null; dailyMax: number | null }
export interface AreaLot { id: number; name: string; address: string | null; parkingType: "ON_STREET" | "OFF_STREET" | "UNKNOWN"; totalSpaces: number | null; fee: FeeSummary; updatedAt: string | null; lat: number | null; lng: number | null }
export interface AreaIndex { sido: string; sigungu: Array<{ name: string; count: number }>; count: number }

type Rule = { rule_type: string; amount: number | null; duration_minutes: number | null; valid_day_type: string; start_time: string | null };

/** 대표 요금 요약. 시간대 한정 규칙(start_time 있음)은 대표값으로 쓰지 않음. 평일 > 매일 순 */
export function summarizeFee(rules: Rule[]): FeeSummary {
  const allDay = rules.filter((r) => r.start_time == null && r.rule_type !== "SEASON_PASS");
  const pick = (t: string) => allDay.find((r) => r.rule_type === t && r.valid_day_type === "WEEKDAY") ?? allDay.find((r) => r.rule_type === t && r.valid_day_type === "EVERYDAY");
  const b = pick("BASE"), dm = pick("DAILY_MAX");
  if (b && b.amount != null && b.duration_minutes) return { kind: "PAID", base: { minutes: b.duration_minutes, amount: b.amount }, dailyMax: dm?.amount ?? null };
  const paidAny = rules.some((r) => (r.rule_type === "BASE" || r.rule_type === "ADDITIONAL") && (r.amount ?? 0) > 0);
  if (!paidAny && allDay.some((r) => r.rule_type === "FREE" && (r.valid_day_type === "EVERYDAY" || r.valid_day_type === "WEEKDAY"))) return { kind: "FREE", base: null, dailyMax: null };
  return { kind: "UNKNOWN", base: null, dailyMax: null };
}

interface Row { id: number; name: string; road_address: string | null; address: string | null; parking_type: AreaLot["parkingType"]; total_spaces: number | null; source_updated_at: string | null; latitude: number | null; longitude: number | null }
type Cache = { at: number; byRegion: Map<string, Row[]>; index: AreaIndex[] };
let cache: Cache | null = null;
const TTL_MS = 60 * 60_000; // 수집은 하루 1회 — 1시간 캐시
const key = (r: Region) => `${r.sido}\u0000${r.sigungu}`;

async function load(db: Db, now = Date.now()): Promise<Cache> {
  if (cache && now - cache.at < TTL_MS) return cache;
  const excluded = mockEnabled() ? [] : NON_PRODUCTION_SOURCES;
  const rows = await db.all<Row>(
    `SELECT id, name, road_address, address, parking_type, total_spaces, source_updated_at, latitude, longitude FROM parking_lots
     WHERE data_status NOT LIKE 'EXCLUDED%'${excluded.length ? ` AND source_name NOT IN (${excluded.map(() => "?").join(",")})` : ""} ORDER BY name, id`, [...excluded]);
  const byRegion = new Map<string, Row[]>();
  const tree = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const g = regionOf(r.road_address) ?? regionOf(r.address);
    if (!g) continue;
    const k = key(g);
    (byRegion.get(k) ?? byRegion.set(k, []).get(k)!).push(r);
    const t = tree.get(g.sido) ?? tree.set(g.sido, new Map()).get(g.sido)!;
    t.set(g.sigungu, (t.get(g.sigungu) ?? 0) + 1);
  }
  const index = [...tree].map(([sido, m]) => ({ sido, sigungu: [...m].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "ko")), count: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.count - a.count);
  cache = { at: now, byRegion, index };
  return cache;
}
export function resetAreaCacheForTest() { cache = null; }

export async function areaIndex(db: Db): Promise<AreaIndex[]> { return (await load(db)).index; }

export async function areaLots(db: Db, region: Region): Promise<AreaLot[] | null> {
  const rows = (await load(db)).byRegion.get(key(region));
  if (!rows) return null;
  const rules = new Map<number, Rule[]>();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id);
    for (const f of await db.all<Rule & { parking_lot_id: number }>(`SELECT parking_lot_id, rule_type, amount, duration_minutes, valid_day_type, start_time FROM fee_rules WHERE parking_lot_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids))
      (rules.get(f.parking_lot_id) ?? rules.set(f.parking_lot_id, []).get(f.parking_lot_id)!).push(f);
  }
  return rows.map((r) => ({ id: r.id, name: r.name, address: r.road_address ?? r.address, parkingType: r.parking_type, totalSpaces: r.total_spaces, fee: summarizeFee(rules.get(r.id) ?? []), updatedAt: r.source_updated_at, lat: r.latitude, lng: r.longitude }));
}

/** 상세 화면 메타데이터·공유 이미지용 가벼운 요약(요금 계산 없이 대표 요금만) */
export async function lotSummary(db: Db, id: number): Promise<(AreaLot & { region: Region | null; operator: string | null }) | null> {
  const r = await db.get<Row & { operator_name: string | null; source_name: string; data_status: string }>(
    "SELECT id, name, road_address, address, parking_type, total_spaces, source_updated_at, latitude, longitude, operator_name, source_name, data_status FROM parking_lots WHERE id = ?", [id]);
  if (!r || r.data_status.startsWith("EXCLUDED")) return null;
  const rules = await db.all<Rule>("SELECT rule_type, amount, duration_minutes, valid_day_type, start_time FROM fee_rules WHERE parking_lot_id = ? ORDER BY id", [id]);
  const address = r.road_address ?? r.address;
  return { id: r.id, name: r.name, address, parkingType: r.parking_type, totalSpaces: r.total_spaces, fee: summarizeFee(rules), updatedAt: r.source_updated_at,
    lat: r.latitude, lng: r.longitude, region: regionOf(r.road_address) ?? regionOf(r.address), operator: r.operator_name };
}
