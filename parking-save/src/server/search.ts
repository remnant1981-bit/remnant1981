// 검색 서비스: 입력 검증 → 후보 조회 → 거리/요금/운영/실시간 평가 → 정렬. API와 서버 렌더 페이지가 공용.
import type { Db } from "./db";
import { MOCK_PLACES, NON_PRODUCTION_SOURCES, mockEnabled, refreshMockOccupancy } from "./mock";
import { calculateFee, type FeeResult, type FeeRule, type DayType } from "@/domain/fee";
import { distanceMeters, isValidCoord, type LatLng } from "@/domain/geo";
import { operatingForStay, operatingUsesAssumed, type OperatingStatus, type ScheduleRow } from "@/domain/operating";
import { evaluateOccupancy, occupancyConfigFor, SEOUL_OCCUPANCY_SOURCE, type OccupancyResult } from "@/domain/occupancy";
import { explainAll, type Explanation } from "@/domain/recommend";
import { cheaperShifts, type CheaperShift } from "@/domain/cheaper";
import { discountTargets, feeAnomalies, type FeeAnomaly } from "@/domain/fee-check";
import { seasonPassHint, type PassHint } from "@/domain/season-pass";
import { kstYmd, parseOffsetIso } from "@/lib/time";
import { HOLIDAY_COVERAGE_MAX_AGE_DAYS } from "@/collector/holidays";

export const SORTS = ["free_first", "price_asc", "distance_asc", "availability_desc", "value_asc"] as const;
/** 가성비 정렬: 걸어가는 거리 100m를 이 금액(원)으로 환산해 예상 요금에 더함 — 임시값(OPEN_ISSUES), 화면에 기준 표시 */
export const WALK_WON_PER_100M = 200;
export type Sort = (typeof SORTS)[number];
export type TypeFilter = "on_street" | "off_street" | "all";

// 임시 운영값(OPEN_ISSUES #6): 기본 1km, 상한 5km. 확정 전.
export const DEFAULT_RADIUS = 1000;
export const MAX_RADIUS = 5000;
export const MAX_STAY_DAYS = 31;
import { staleDaysFor } from "./freshness";
import { dayKind, occupancyTrend, TREND_WINDOW_DAYS, type Trend } from "@/domain/occupancy-trend";
import type { ResolvedPlace } from "./place";
import { activeOverrides } from "./overrides";

export interface SearchParams {
  center: LatLng; centerLabel: string; centerKind: "current_location" | "destination";
  radiusMeters: number; startAt: Date; endAt: Date; sort: Sort; type: TypeFilter;
  freeOnly: boolean; realtimeOnly: boolean; operatingOnly: boolean; limit: number;
  /** 추천 사유 문구 언어(화면 언어). 없으면 한국어 */
  lang?: "ko" | "en";
  /** 목적지를 보유 주소 데이터로 찾은 경우(대략 위치 안내·다른 후보 지역 표시용) */
  place?: ResolvedPlace;
}
export type ParseResult = { ok: true; params: SearchParams } | { ok: false; code: string; message: string };
const bad = (code: string, message: string): ParseResult => ({ ok: false, code, message });

/** @param resolved 목적지 문자열을 보유 주소 데이터로 찾은 위치(resolveDestination). 목업 장소가 우선 */
export function parseSearchParams(q: URLSearchParams, resolved?: ResolvedPlace | null): ParseResult {
  const lat = q.get("lat"), lng = q.get("lng"), dest = q.get("destination")?.trim();
  let center: LatLng, label: string, kind: SearchParams["centerKind"], place: ResolvedPlace | undefined;
  if (lat != null && lat !== "" || lng != null && lng !== "") {
    center = { lat: Number(lat), lng: Number(lng) };
    if (lat === "" || lng === "" || lat == null || lng == null || !isValidCoord(center)) return bad("INVALID_COORDINATES", "위치 좌표가 올바르지 않습니다.");
    label = "현재 위치"; kind = "current_location";
  } else if (dest) {
    if (dest.length > 100) return bad("INVALID_DESTINATION", "목적지가 너무 깁니다.");
    const p = (mockEnabled() ? MOCK_PLACES[dest] : undefined) ?? (resolved ? { lat: resolved.lat, lng: resolved.lng } : undefined); // 정식 지오코딩 미연동(D7) — 보유 주소 데이터로 찾음
    if (!p) return bad("DESTINATION_NOT_FOUND", mockEnabled()
      ? `목적지를 찾을 수 없습니다. (목업 모드: ${Object.keys(MOCK_PLACES).join(", ")} 또는 주차장 이름·주소에 있는 말로 검색)`
      : "입력한 말이 들어간 주차장 이름·주소를 찾지 못했습니다. 동·도로명·시설 이름(예: 역삼동, 세종대로)으로 다시 검색하거나 '현재 위치 사용'을 눌러 주세요.");
    center = p; label = dest; kind = "destination";
    if (resolved && !(mockEnabled() && MOCK_PLACES[dest])) place = resolved;
  } else return bad("MISSING_CENTER", "현재 위치 또는 목적지를 입력하세요.");

  const rad = q.get("radiusMeters") ? Number(q.get("radiusMeters")) : DEFAULT_RADIUS;
  if (!Number.isFinite(rad) || rad < 100 || rad > MAX_RADIUS) return bad("INVALID_RADIUS", `검색 반경은 100~${MAX_RADIUS}m 범위여야 합니다.`);

  const startAt = parseOffsetIso(q.get("startAt")), endAt = parseOffsetIso(q.get("endAt"));
  if (!startAt || !endAt) return bad("INVALID_PERIOD", "주차 시작·종료 일시를 오프셋 포함 ISO 8601 형식으로 입력하세요.");
  if (endAt <= startAt) return bad("INVALID_PERIOD", "종료 일시는 시작 일시보다 늦어야 합니다.");
  if (endAt.getTime() - startAt.getTime() > MAX_STAY_DAYS * 86400_000) return bad("PERIOD_TOO_LONG", `주차 기간은 최대 ${MAX_STAY_DAYS}일입니다.`);

  const sort = (q.get("sort") ?? "free_first") as Sort;
  if (!SORTS.includes(sort)) return bad("INVALID_SORT", "지원하지 않는 정렬입니다.");
  const type = (q.get("type") ?? "all") as TypeFilter;
  if (!["on_street", "off_street", "all"].includes(type)) return bad("INVALID_TYPE", "지원하지 않는 시설 유형입니다.");
  const limit = q.get("limit") ? Number(q.get("limit")) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad("INVALID_LIMIT", "limit은 1~100입니다.");
  const flag = (k: string) => q.get(k) === "true" || q.get(k) === "1" || q.get(k) === "on";
  return { ok: true, params: { center, centerLabel: label, centerKind: kind, radiusMeters: rad, startAt, endAt, sort, type, freeOnly: flag("freeOnly"), realtimeOnly: flag("realtimeOnly"), operatingOnly: flag("operatingOnly"), limit, lang: q.get("lang") === "en" ? "en" : "ko", place } };
}

interface LotRow {
  id: number; source_name: string; source_record_id: string; name: string; operator_name: string | null;
  parking_type: "ON_STREET" | "OFF_STREET" | "UNKNOWN"; ownership_type: "PUBLIC" | "UNKNOWN";
  address: string | null; road_address: string | null; latitude: number | null; longitude: number | null;
  total_spaces: number | null; phone: string | null; source_url: string | null;
  source_updated_at: string | null; collected_at: string; data_status: string; quality_flags: string | null; fee_note: string | null;
}
interface FeeRow { id: number; parking_lot_id: number; rule_type: string; amount: number | null; duration_minutes: number | null; valid_day_type: DayType; start_time: string | null; end_time: string | null; daily_max_basis: string | null }
interface SchedRow { parking_lot_id: number; day_type: DayType; open_time: string | null; close_time: string | null; all_day_flag: number | null; closed_flag: number | null; holiday_policy: string | null }

export function toFeeRules(rows: FeeRow[]): FeeRule[] | "UNSUPPORTED" {
  const out: FeeRule[] = [];
  for (const r of rows) {
    if (r.rule_type === "SEASON_PASS") continue; // 정기권은 시간제 요금 계산과 무관 — 있어도 계산을 막지 않음
    if (!["BASE", "ADDITIONAL", "DAILY_MAX", "FREE"].includes(r.rule_type)) return "UNSUPPORTED"; // 정기권 등은 계산에 쓰지 않으며 계산 불가로 처리
    out.push({ id: r.id, ruleType: r.rule_type as FeeRule["ruleType"], amount: r.amount, durationMinutes: r.duration_minutes, dayType: r.valid_day_type,
      startTime: r.start_time, endTime: r.end_time, dailyMaxBasis: r.daily_max_basis as FeeRule["dailyMaxBasis"] });
  }
  return out;
}
export const toSchedules = (rows: SchedRow[]): ScheduleRow[] =>
  rows.map((r) => ({ dayType: r.day_type, openTime: r.open_time, closeTime: r.close_time, allDay: r.all_day_flag === 1, closed: r.closed_flag === 1, assumed: r.holiday_policy === "SUNDAY_ASSUMED" }));

/** 기간이 공휴일 데이터 보장 범위 안일 때만 공휴일 집합 반환, 아니면 null(판정 불가) */
export async function loadHolidays(db: Db, start: Date, end: Date, now = new Date()): Promise<Set<string> | null> {
  const from = kstYmd(start.getTime()), to = kstYmd(end.getTime());
  // 커버리지가 기간을 덮고, 마지막 성공 수집이 오래되지 않았을 때만(임시공휴일 누락 위험) 판정 가능
  const cutoff = new Date(now.getTime() - HOLIDAY_COVERAGE_MAX_AGE_DAYS * 86400_000).toISOString();
  const cov = await db.get("SELECT 1 AS ok FROM holiday_coverage WHERE from_date <= ? AND to_date >= ? AND collected_at >= ? LIMIT 1", [from, to, cutoff]);
  if (!cov) return null;
  const rows = await db.all<{ date: string }>("SELECT date FROM holidays WHERE date BETWEEN ? AND ?", [from, to]);
  return new Set(rows.map((r) => r.date));
}

export interface FeeView { status: "OK" | "UNKNOWN"; amount?: number; isFree?: boolean; reason?: string; detail?: string; notes?: string[]; assumptions?: string[]; days?: unknown[] }
export function feeView(r: FeeResult | { status: "UNKNOWN"; reason: string; detail: string }): FeeView {
  return r.status === "OK" ? { status: "OK", amount: r.amount, isFree: r.isFree, notes: r.notes, assumptions: "assumptions" in r ? r.assumptions : [], days: r.days } : { status: "UNKNOWN", reason: r.reason, detail: r.detail };
}

export interface LotItem {
  id: number; name: string; address: string | null; parkingType: LotRow["parking_type"]; ownershipType: LotRow["ownership_type"];
  latitude: number; longitude: number; distanceMeters: number; totalSpaces: number | null;
  fee: FeeView; operating: OperatingStatus; operatingAssumed: boolean; occupancy: OccupancyResult;
  source: { name: string; url: string | null; updatedAt: string | null; collectedAt: string; freshness: "FRESH" | "STALE"; notInLatestSync: boolean };
  isMock: boolean; qualityFlags: string[]; feeNote: string | null;
  /** 원천 요금 이상치(있으면 경고, 최저가 강조 제외) */
  feeWarnings: FeeAnomaly[];
  /** 특기사항의 감면·할인 대상(안내만, 금액 미반영) */
  discounts: string[];
  /** 원천 월정기권 요금(판매·자격 조건 미확인)과 장기 이용 안내 */
  monthlyPass: number | null;
  passHint: PassHint | null;
  explanation: Explanation;
  /** 같은 시설일 가능성이 높아 이 항목 아래로 묶인 다른 레코드(삭제·병합 아님, 상세에서 개별 확인 가능) */
  similar: Array<{ id: number; name: string; distanceMeters: number; status: "MERGED" | "PENDING"; source: string }>;
}

/**
 * 시설의 최신 실시간 점유. 자기 스냅샷 + 관리자가 '동일 시설'로 승인한(duplicate_candidates.status='MERGED') 레코드의 스냅샷 중 가장 최근 것.
 * 승인되지 않은 후보는 쓰지 않는다. 신선도 기준은 스냅샷 원천별.
 */
async function occupancyFor(db: Db, lotId: number, now: Date): Promise<OccupancyResult> {
  const snap = await db.get<{ total_spaces: number | null; available_spaces: number | null; observed_at: string | null; source_name: string }>(
    `SELECT total_spaces, available_spaces, observed_at, source_name FROM occupancy_snapshots
     WHERE parking_lot_id = ? OR parking_lot_id IN (
       SELECT CASE WHEN lot_a_id = ? THEN lot_b_id ELSE lot_a_id END FROM duplicate_candidates WHERE status = 'MERGED' AND (lot_a_id = ? OR lot_b_id = ?))
     ORDER BY collected_at DESC, id DESC LIMIT 1`, [lotId, lotId, lotId, lotId]);
  return evaluateOccupancy({ totalSpaces: snap?.total_spaces, availableSpaces: snap?.available_spaces, observedAt: snap?.observed_at }, now, occupancyConfigFor(snap?.source_name));
}

/**
 * 원천별 가장 최근 '성공/부분 성공' 수집 시작 시각. 시설의 collected_at이 이보다 이르면 그 수집에서 보이지 않은 시설(삭제 아님, '최근 수집에서 미확인').
 * 실패한 수집은 아무것도 저장하지 않으므로 기준에서 제외한다. 수집 이력이 없는 원천(목업 등)은 판정하지 않는다.
 */
export async function latestSyncStarts(db: Db): Promise<Map<string, string>> {
  const rows = await db.all<{ source_name: string; at: string }>("SELECT source_name, MAX(started_at) AS at FROM source_sync_logs WHERE status IN ('SUCCESS','PARTIAL') GROUP BY source_name");
  return new Map(rows.map((r) => [r.source_name, r.at]));
}
export const notInLatestSync = (lot: { source_name: string; collected_at: string }, starts: Map<string, string>) => {
  const at = starts.get(lot.source_name);
  return at !== undefined && lot.collected_at < at;
};

/** 검색 한 번에 필요한 시설별 행을 IN 조회로 한꺼번에 읽어 N+1 쿼리를 없앤다(후보 수에 비례하던 왕복 제거). */
interface Preloaded { fees: Map<number, FeeRow[]>; scheds: Map<number, SchedRow[]>; occMaybe: Set<number> }
const IN_CHUNK = 400;
async function loadGrouped<T extends { parking_lot_id: number }>(db: Db, table: "fee_rules" | "operating_schedules", ids: number[]): Promise<Map<number, T[]>> {
  const out = new Map<number, T[]>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK);
    const rows = await db.all<T>(`SELECT * FROM ${table} WHERE parking_lot_id IN (${part.map(() => "?").join(",")}) ORDER BY id`, part);
    for (const r of rows) { const a = out.get(r.parking_lot_id); if (a) a.push(r); else out.set(r.parking_lot_id, [r]); }
  }
  return out;
}
async function preload(db: Db, ids: number[]): Promise<Preloaded> {
  const [fees, scheds, occ] = await Promise.all([
    loadGrouped<FeeRow>(db, "fee_rules", ids),
    loadGrouped<SchedRow>(db, "operating_schedules", ids),
    // 스냅샷이 있는 시설 + 승인(MERGED) 연결 시설의 상위집합. 이 밖의 시설은 실시간 데이터가 있을 수 없어 개별 조회를 생략한다.
    db.all<{ id: number }>("SELECT parking_lot_id AS id FROM occupancy_snapshots UNION SELECT lot_a_id FROM duplicate_candidates WHERE status='MERGED' UNION SELECT lot_b_id FROM duplicate_candidates WHERE status='MERGED'"),
  ]);
  return { fees, scheds, occMaybe: new Set(occ.map((r) => r.id)) };
}

async function evaluateLot(db: Db, lot: LotRow, p: Pick<SearchParams, "startAt" | "endAt">, holidays: Set<string> | null, now: Date, pre?: Preloaded) {
  const feeRows = pre ? pre.fees.get(lot.id) ?? [] : await db.all<FeeRow>("SELECT * FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [lot.id]);
  const rules = toFeeRules(feeRows);
  const fee = rules === "UNSUPPORTED"
    ? feeView({ status: "UNKNOWN", reason: "UNSUPPORTED_RULE", detail: "계산에 지원되지 않는 요금 유형 포함" })
    : feeView(calculateFee({ startAt: p.startAt, endAt: p.endAt, rules, holidays }));
  const sched = toSchedules(pre ? pre.scheds.get(lot.id) ?? [] : await db.all<SchedRow>("SELECT * FROM operating_schedules WHERE parking_lot_id=?", [lot.id]));
  const operating = operatingForStay(sched, p.startAt.getTime(), p.endAt.getTime(), holidays);
  const operatingAssumed = operating !== "UNKNOWN" && operatingUsesAssumed(sched, p.startAt.getTime(), p.endAt.getTime(), holidays);
  const occupancy = pre && !pre.occMaybe.has(lot.id) ? evaluateOccupancy({ totalSpaces: null, availableSpaces: null, observedAt: null }, now) : await occupancyFor(db, lot.id, now);
  const stale = (now.getTime() - Date.parse(lot.source_updated_at ?? lot.collected_at)) / 86400_000 > staleDaysFor(lot.source_name);
  const feeWarnings = rules === "UNSUPPORTED" ? [] : feeAnomalies(rules);
  const monthlyPass = feeRows.find((r) => r.rule_type === "SEASON_PASS" && r.amount != null && r.amount > 0)?.amount ?? null;
  const passHint = seasonPassHint({ pass: monthlyPass, stayMinutes: (p.endAt.getTime() - p.startAt.getTime()) / 60000, fee: fee.status === "OK" ? fee.amount! : null });
  return { fee, operating, operatingAssumed, occupancy, freshness: (stale ? "STALE" : "FRESH") as "FRESH" | "STALE", rules, sched, feeWarnings, monthlyPass, passHint };
}

export interface SearchResponse {
  items: LotItem[];
  searchCenter: { lat: number; lng: number; label: string; kind: SearchParams["centerKind"]; place: { region: string; matches: number; otherRegions: string[] } | null };
  picks: Picks;
  requestedPeriod: { startAt: string; endAt: string; timezone: "Asia/Seoul" };
  dataCoverage: { candidates: number; returned: number; feeCalculable: number; feeUnknown: number; withValidRealtime: number; holidayDataAvailable: boolean; isMockData: boolean; excludedNoCoordinates: number };
  warnings: string[];
}

export interface PickItem { id: number; name: string; distanceMeters: number; amount: number | null; isFree: boolean }
export interface Picks { cheapest: PickItem | null; nearest: PickItem | null; nearestFree: PickItem | null }
/**
 * 한눈에 보기: 조건에 맞는 전체 후보(표시 개수 제한 전) 중 최저 요금·가장 가까운 곳·가장 가까운 무료.
 * 요금 계산 불가 시설은 최저 요금 후보에서 제외(0원으로 보지 않음), 원천 요금 값이 이상한 시설도 제외. 후보가 2곳 미만이면 표시하지 않음.
 */
export function pickHighlights(items: LotItem[]): Picks {
  if (items.length < 2) return { cheapest: null, nearest: null, nearestFree: null };
  const toPick = (i: LotItem): PickItem => ({ id: i.id, name: i.name, distanceMeters: i.distanceMeters, amount: i.fee.status === "OK" ? i.fee.amount! : null, isFree: i.fee.status === "OK" && !!i.fee.isFree });
  const byDist = (a: LotItem, b: LotItem) => a.distanceMeters - b.distanceMeters || a.id - b.id;
  const priced = items.filter((i) => i.fee.status === "OK" && i.feeWarnings.length === 0);
  const cheapest = [...priced].sort((a, b) => a.fee.amount! - b.fee.amount! || byDist(a, b))[0];
  const nearest = [...items].sort(byDist)[0];
  const nearestFree = priced.filter((i) => i.fee.isFree).sort(byDist)[0];
  return { cheapest: cheapest ? toPick(cheapest) : null, nearest: toPick(nearest), nearestFree: nearestFree ? toPick(nearestFree) : null };
}

export async function searchLots(db: Db, p: SearchParams, now = new Date()): Promise<SearchResponse> {
  if (mockEnabled()) await refreshMockOccupancy(db, now);
  const dLat = p.radiusMeters / 111320, dLng = p.radiusMeters / (111320 * Math.max(0.01, Math.cos((p.center.lat * Math.PI) / 180)));
  const types = p.type === "all" ? ["ON_STREET", "OFF_STREET", "UNKNOWN"] : [p.type === "on_street" ? "ON_STREET" : "OFF_STREET"];
  const lots = await db.all<LotRow>(
    `SELECT * FROM parking_lots WHERE data_status NOT LIKE 'EXCLUDED%' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? AND parking_type IN (${types.map(() => "?").join(",")})`,
    [p.center.lat - dLat, p.center.lat + dLat, p.center.lng - dLng, p.center.lng + dLng, ...types]);
  const noCoord = (await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM parking_lots WHERE latitude IS NULL OR longitude IS NULL"))?.c ?? 0;
  const holidays = await loadHolidays(db, p.startAt, p.endAt, now);

  const syncStarts = await latestSyncStarts(db);
  const inRange: Array<{ lot: LotRow; dist: number }> = [];
  for (const lot of lots) {
    const dist = distanceMeters(p.center, { lat: lot.latitude!, lng: lot.longitude! });
    if (dist <= p.radiusMeters) inRange.push({ lot, dist });
  }
  const pre = await preload(db, inRange.map((x) => x.lot.id));
  let items: LotItem[] = [];
  for (const { lot, dist } of inRange) {
    const here = { lat: lot.latitude!, lng: lot.longitude! };
    const ev = await evaluateLot(db, lot, p, holidays, now, pre);
    items.push({
      id: lot.id, name: lot.name, address: lot.road_address ?? lot.address, parkingType: lot.parking_type, ownershipType: lot.ownership_type,
      latitude: here.lat, longitude: here.lng, distanceMeters: Math.round(dist), totalSpaces: lot.total_spaces,
      fee: ev.fee, operating: ev.operating, operatingAssumed: ev.operatingAssumed, occupancy: ev.occupancy,
      source: { name: lot.source_name, url: lot.source_url, updatedAt: lot.source_updated_at, collectedAt: lot.collected_at, freshness: ev.freshness, notInLatestSync: notInLatestSync(lot, syncStarts) },
      isMock: NON_PRODUCTION_SOURCES.includes(lot.source_name), qualityFlags: lot.quality_flags ? JSON.parse(lot.quality_flags) : [], feeNote: lot.fee_note, feeWarnings: ev.feeWarnings, discounts: discountTargets(lot.fee_note), monthlyPass: ev.monthlyPass, passHint: ev.passHint,
      explanation: { highlights: [], cautions: [] }, similar: [],
    });
  }
  const candidates = items.length;
  if (p.freeOnly) items = items.filter((i) => i.fee.status === "OK" && i.fee.isFree);
  if (p.realtimeOnly) items = items.filter((i) => i.occupancy.status === "AVAILABLE");
  // 이용 시간 전체에 운영이 확인된 곳만(운영 외·확인 불가 제외 — 확인 불가를 운영 중으로 보지 않음)
  if (p.operatingOnly) items = items.filter((i) => i.operating === "OPERATING");
  items.sort(comparator(p.sort));
  items = await groupSimilar(db, items);
  const picks = pickHighlights(items);
  items = items.slice(0, p.limit);
  const why = explainAll(items, p.lang ?? "ko"); // 표시되는 시설 집합 기준 설명(정렬에는 영향 없음)
  for (const i of items) i.explanation = why.get(i.id)!;

  const warnings: string[] = [];
  if (items.some((i) => i.isMock)) warnings.push("MOCK_DATA: 표시된 일부 정보는 목업 또는 샘플(검증 전) 데이터이며 실제 서비스 데이터가 아닙니다.");
  if (!holidays) warnings.push("HOLIDAY_DATA_MISSING: 입력 기간의 공휴일 데이터가 없어 요일별 규칙이 있는 시설은 요금을 계산하지 못할 수 있습니다.");
  if (items.some((i) => i.ownershipType === "UNKNOWN")) warnings.push("OWNERSHIP_UNVERIFIED: 공영 여부가 확인되지 않은 시설이 포함되어 있습니다.");
  if (items.some((i) => i.source.freshness === "STALE")) warnings.push("STALE_DATA: 오래된 데이터가 포함되어 있습니다.");
  if (items.some((i) => i.source.notInLatestSync)) warnings.push("NOT_IN_LATEST_SYNC: 최근 수집에서 확인되지 않은 시설이 포함되어 있습니다(폐쇄·정보 변경 가능성, 현장 확인 필요).");
  if (candidates === 0) warnings.push("EMPTY: 조건에 맞는 주차장이 없습니다.");
  return {
    items,
    searchCenter: { lat: p.center.lat, lng: p.center.lng, label: p.centerLabel, kind: p.centerKind, place: p.place ? { region: p.place.region, matches: p.place.matches, otherRegions: p.place.otherRegions } : null },
    picks,
    requestedPeriod: { startAt: p.startAt.toISOString(), endAt: p.endAt.toISOString(), timezone: "Asia/Seoul" },
    dataCoverage: {
      candidates, returned: items.length,
      feeCalculable: items.filter((i) => i.fee.status === "OK").length, feeUnknown: items.filter((i) => i.fee.status !== "OK").length,
      withValidRealtime: items.filter((i) => i.occupancy.status === "AVAILABLE").length,
      holidayDataAvailable: holidays !== null, isMockData: items.some((i) => i.isMock), excludedNoCoordinates: noCoord,
    },
    warnings,
  };
}

/** 같은 시설 후보로 묶는 최소 점수(PENDING). 승인(MERGED)된 쌍은 점수와 무관하게 묶는다. 거절(REJECTED)은 절대 묶지 않는다. */
export const GROUP_MIN_SCORE = 1.0;

/**
 * 정렬된 결과에서 '동일 시설 확정/거의 확실' 쌍을 먼저 나온 항목 아래로 묶는다. 레코드는 삭제·병합하지 않고 `similar`로 남겨 사용자가 확인할 수 있게 한다.
 * 자동 병합 금지 원칙 유지: 묶음은 표시 방식일 뿐 DB는 바뀌지 않는다.
 */
async function groupSimilar(db: Db, sorted: LotItem[]): Promise<LotItem[]> {
  if (sorted.length < 2) return sorted;
  const ids = sorted.map((i) => i.id);
  const ph = ids.map(() => "?").join(",");
  const links = await db.all<{ lot_a_id: number; lot_b_id: number; status: "MERGED" | "PENDING"; score: number | null }>(
    `SELECT lot_a_id, lot_b_id, status, score FROM duplicate_candidates WHERE status <> 'REJECTED' AND lot_a_id IN (${ph}) AND lot_b_id IN (${ph})`, [...ids, ...ids]);
  const linked = new Map<number, Map<number, "MERGED" | "PENDING">>();
  const add = (a: number, b: number, st: "MERGED" | "PENDING") => { if (!linked.has(a)) linked.set(a, new Map()); linked.get(a)!.set(b, st); };
  for (const l of links) {
    if (l.status === "PENDING" && (l.score ?? 0) < GROUP_MIN_SCORE) continue;
    add(l.lot_a_id, l.lot_b_id, l.status); add(l.lot_b_id, l.lot_a_id, l.status);
  }
  if (linked.size === 0) return sorted;
  const kept: LotItem[] = [];
  for (const it of sorted) {
    const head = kept.find((k) => linked.get(k.id)?.has(it.id));
    if (head) head.similar.push({ id: it.id, name: it.name, distanceMeters: it.distanceMeters, status: linked.get(head.id)!.get(it.id)!, source: it.source.name });
    else kept.push(it);
  }
  return kept;
}

// 정렬: 요금 계산 불가 시설은 가격 순위에 포함하지 않고 뒤로 보낸다. 잔여면수 없음은 감점이 아니라 단지 뒤(거리순).
function comparator(sort: Sort) {
  const price = (i: LotItem) => (i.fee.status === "OK" ? i.fee.amount! : Number.POSITIVE_INFINITY);
  const avail = (i: LotItem) => (i.occupancy.status === "AVAILABLE" ? i.occupancy.availableSpaces : -1);
  const byDist = (a: LotItem, b: LotItem) => a.distanceMeters - b.distanceMeters || a.id - b.id;
  return (a: LotItem, b: LotItem) => {
    if (sort === "distance_asc") return byDist(a, b);
    if (sort === "price_asc") return price(a) - price(b) || byDist(a, b);
    if (sort === "availability_desc") return avail(b) - avail(a) || byDist(a, b);
    if (sort === "value_asc") { const v = (i: LotItem) => price(i) + (i.distanceMeters / 100) * WALK_WON_PER_100M; return v(a) - v(b) || byDist(a, b); }
    const free = (i: LotItem) => (i.fee.status === "OK" && i.fee.isFree ? 0 : 1); // free_first
    return free(a) - free(b) || price(a) - price(b) || byDist(a, b);
  };
}

/**
 * 혼잡 경향(평소 이 요일 유형·시간대의 빈자리 비율). 자기 집계 + 관리자 승인(MERGED) 연결 시설의 집계를 함께 사용(occupancyFor와 같은 기준).
 * 공휴일은 커버리지가 있는 날짜만 판정(커버리지 밖 평일은 제외). 목표 날짜 유형을 모르면 null.
 */
export async function occupancyTrendFor(db: Db, lotId: number, startAt: Date, now: Date, cfg = occupancyConfigFor(SEOUL_OCCUPANCY_SOURCE)): Promise<Trend | null> {
  const fromYmd = kstYmd(now.getTime() - TREND_WINDOW_DAYS * 86400_000), toYmd = kstYmd(Math.max(now.getTime(), startAt.getTime()));
  const rows = await db.all<{ ymd: string; hour: number; ratio_sum: number; samples: number }>(
    `SELECT ymd, hour, ratio_sum, samples FROM occupancy_hourly WHERE ymd >= ? AND (parking_lot_id = ? OR parking_lot_id IN (
       SELECT CASE WHEN lot_a_id = ? THEN lot_b_id ELSE lot_a_id END FROM duplicate_candidates WHERE status = 'MERGED' AND (lot_a_id = ? OR lot_b_id = ?)))`,
    [fromYmd, lotId, lotId, lotId, lotId]);
  if (rows.length === 0) return null;
  const cov = await db.all<{ from_date: string; to_date: string }>("SELECT from_date, to_date FROM holiday_coverage WHERE to_date >= ? AND from_date <= ?", [fromYmd, toYmd]);
  const hol = new Set((await db.all<{ date: string }>("SELECT date FROM holidays WHERE date BETWEEN ? AND ?", [fromYmd, toYmd])).map((r) => r.date));
  const holidaysFor = (ymd: string) => (cov.some((c) => c.from_date <= ymd && ymd <= c.to_date) ? hol : null);
  const ymd = kstYmd(startAt.getTime());
  const kind = dayKind(ymd, holidaysFor(ymd));
  if (!kind) return null;
  const hour = new Date(startAt.getTime() + 9 * 3600_000).getUTCHours();
  return occupancyTrend(rows.map((r) => ({ ymd: r.ymd, hour: r.hour, ratioSum: r.ratio_sum, samples: r.samples })), { kind, hour }, holidaysFor, cfg);
}

export async function getLotDetail(db: Db, id: number, period: { startAt: Date; endAt: Date } | null, now = new Date()) {
  if (mockEnabled()) await refreshMockOccupancy(db, now);
  const lot = await db.get<LotRow>("SELECT * FROM parking_lots WHERE id=?", [id]);
  if (!lot) return null;
  const feeRules = await db.all<FeeRow>("SELECT * FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [id]);
  const schedules = await db.all<SchedRow>("SELECT * FROM operating_schedules WHERE parking_lot_id=?", [id]);
  const occupancy = await occupancyFor(db, id, now);
  let fee: FeeView | null = null, operating: OperatingStatus | null = null, operatingAssumed = false, holidayDataAvailable: boolean | null = null, passHint: PassHint | null = null;
  if (period) {
    const holidays = await loadHolidays(db, period.startAt, period.endAt, now);
    holidayDataAvailable = holidays !== null;
    const ev = await evaluateLot(db, lot, period, holidays, now);
    fee = ev.fee; operating = ev.operating; operatingAssumed = ev.operatingAssumed; passHint = ev.passHint;
  }
  const monthlyPass = feeRules.find((r) => r.rule_type === "SEASON_PASS" && r.amount != null && r.amount > 0)?.amount ?? null;
  const detailRules = toFeeRules(feeRules);
  const feeWarnings = detailRules === "UNSUPPORTED" ? [] : feeAnomalies(detailRules);
  const engineRules = toFeeRules(feeRules);
  // 이용 시간별 요금 곡선(1~12시간): 요청 시작 시각 기준. 계산 불가 구간은 null(0원으로 그리지 않음)
  let feeCurve: Array<{ hours: number; fee: number | null; capped: boolean }> | null = null;
  if (period && engineRules !== "UNSUPPORTED") {
    const s = period.startAt.getTime();
    const hol = await loadHolidays(db, period.startAt, new Date(s + FEE_CURVE_HOURS * 3600_000), now);
    feeCurve = Array.from({ length: FEE_CURVE_HOURS }, (_, k) => {
      const r = calculateFee({ startAt: period.startAt, endAt: new Date(s + (k + 1) * 3600_000), rules: engineRules, holidays: hol });
      return { hours: k + 1, fee: r.status === "OK" ? r.amount : null, capped: r.status === "OK" && r.days.some((d) => d.capped) };
    });
  }
  // 더 싼 시간대: 같은 이용 시간을 30·60분 앞뒤로 옮겼을 때(요금·운영 모두 확인된 경우만)
  let cheaper: CheaperShift[] = [];
  if (period && engineRules !== "UNSUPPORTED" && fee?.status === "OK" && !fee.isFree) {
    const hol = await loadHolidays(db, new Date(period.startAt.getTime() - 3600_000), new Date(period.endAt.getTime() + 3600_000), now);
    cheaper = cheaperShifts({ rules: engineRules, schedules: toSchedules(schedules), holidays: hol, startAt: period.startAt, endAt: period.endAt, now, baseFee: fee.amount! });
  }
  // 주차 타이머: 기기에서 같은 요금 엔진으로 계산하도록 규칙과 공휴일(오늘부터 3일)을 함께 전달
  const timerHolidays = await loadHolidays(db, now, new Date(now.getTime() + 3 * 86400_000), now);
  const timer = engineRules === "UNSUPPORTED" ? null : {
    rules: engineRules, schedules: toSchedules(schedules),
    holidays: timerHolidays ? { from: kstYmd(now.getTime()), to: kstYmd(now.getTime() + 3 * 86400_000), dates: [...timerHolidays] } : null,
  };
  return {
    lot: {
      id: lot.id, name: lot.name, operatorName: lot.operator_name, parkingType: lot.parking_type, ownershipType: lot.ownership_type, address: lot.address, roadAddress: lot.road_address,
      latitude: lot.latitude, longitude: lot.longitude, totalSpaces: lot.total_spaces, phone: lot.phone, isMock: NON_PRODUCTION_SOURCES.includes(lot.source_name),
      qualityFlags: lot.quality_flags ? (JSON.parse(lot.quality_flags) as string[]) : [], feeNote: lot.fee_note,
    },
    source: { name: lot.source_name, url: lot.source_url, updatedAt: lot.source_updated_at, collectedAt: lot.collected_at, notInLatestSync: notInLatestSync(lot, await latestSyncStarts(db)) },
    feeRules: feeRules.map((r) => ({ ruleType: r.rule_type, amount: r.amount, durationMinutes: r.duration_minutes, dayType: r.valid_day_type, startTime: r.start_time, endTime: r.end_time, dailyMaxBasis: r.daily_max_basis })),
    operatingSchedules: schedules.map((s) => ({ dayType: s.day_type, openTime: s.open_time, closeTime: s.close_time, allDay: s.all_day_flag === 1, closed: s.closed_flag === 1, assumed: s.holiday_policy === "SUNDAY_ASSUMED" })),
    occupancy, fee, operating, operatingAssumed, holidayDataAvailable,
    requestedPeriod: period ? { startAt: period.startAt.toISOString(), endAt: period.endAt.toISOString(), timezone: "Asia/Seoul" } : null,
    feeCurve, timer, cheaper, feeWarnings, discounts: discountTargets(lot.fee_note), monthlyPass, passHint,
    occupancyTrend: period ? await occupancyTrendFor(db, id, period.startAt, now) : null,
    overrides: await activeOverrides(db, id),
  };
}
export const FEE_CURVE_HOURS = 12;
