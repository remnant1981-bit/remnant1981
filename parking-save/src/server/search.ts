// 검색 서비스: 입력 검증 → 후보 조회 → 거리/요금/운영/실시간 평가 → 정렬. API와 서버 렌더 페이지가 공용.
import type { Db } from "./db";
import { MOCK_PLACES, NON_PRODUCTION_SOURCES, mockEnabled, refreshMockOccupancy } from "./mock";
import { calculateFee, type FeeResult, type FeeRule, type DayType } from "@/domain/fee";
import { distanceMeters, isValidCoord, type LatLng } from "@/domain/geo";
import { operatingForStay, type OperatingStatus, type ScheduleRow } from "@/domain/operating";
import { evaluateOccupancy, type OccupancyResult } from "@/domain/occupancy";
import { kstYmd, parseOffsetIso } from "@/lib/time";
import { HOLIDAY_COVERAGE_MAX_AGE_DAYS } from "@/collector/holidays";

export const SORTS = ["free_first", "price_asc", "distance_asc", "availability_desc"] as const;
export type Sort = (typeof SORTS)[number];
export type TypeFilter = "on_street" | "off_street" | "all";

// 임시 운영값(OPEN_ISSUES #6): 기본 1km, 상한 5km. 확정 전.
export const DEFAULT_RADIUS = 1000;
export const MAX_RADIUS = 5000;
export const MAX_STAY_DAYS = 31;
const STALE_DATA_DAYS = 7; // 원천 기준일 신선도 임시값

export interface SearchParams {
  center: LatLng; centerLabel: string; centerKind: "current_location" | "destination";
  radiusMeters: number; startAt: Date; endAt: Date; sort: Sort; type: TypeFilter;
  freeOnly: boolean; realtimeOnly: boolean; limit: number;
}
export type ParseResult = { ok: true; params: SearchParams } | { ok: false; code: string; message: string };
const bad = (code: string, message: string): ParseResult => ({ ok: false, code, message });

export function parseSearchParams(q: URLSearchParams): ParseResult {
  const lat = q.get("lat"), lng = q.get("lng"), dest = q.get("destination")?.trim();
  let center: LatLng, label: string, kind: SearchParams["centerKind"];
  if (lat != null && lat !== "" || lng != null && lng !== "") {
    center = { lat: Number(lat), lng: Number(lng) };
    if (lat === "" || lng === "" || lat == null || lng == null || !isValidCoord(center)) return bad("INVALID_COORDINATES", "위치 좌표가 올바르지 않습니다.");
    label = "현재 위치"; kind = "current_location";
  } else if (dest) {
    if (dest.length > 100) return bad("INVALID_DESTINATION", "목적지가 너무 깁니다.");
    const p = mockEnabled() ? MOCK_PLACES[dest] : undefined; // 실제 지오코딩 미연동(D7)
    if (!p) return bad("DESTINATION_NOT_FOUND", `목적지를 찾을 수 없습니다. (목업 모드: ${Object.keys(MOCK_PLACES).join(", ")}만 검색 가능)`);
    center = p; label = dest; kind = "destination";
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
  return { ok: true, params: { center, centerLabel: label, centerKind: kind, radiusMeters: rad, startAt, endAt, sort, type, freeOnly: flag("freeOnly"), realtimeOnly: flag("realtimeOnly"), limit } };
}

interface LotRow {
  id: number; source_name: string; source_record_id: string; name: string; operator_name: string | null;
  parking_type: "ON_STREET" | "OFF_STREET" | "UNKNOWN"; ownership_type: "PUBLIC" | "UNKNOWN";
  address: string | null; road_address: string | null; latitude: number | null; longitude: number | null;
  total_spaces: number | null; phone: string | null; source_url: string | null;
  source_updated_at: string | null; collected_at: string; data_status: string; quality_flags: string | null;
}
interface FeeRow { id: number; rule_type: string; amount: number | null; duration_minutes: number | null; valid_day_type: DayType; start_time: string | null; end_time: string | null; daily_max_basis: string | null }
interface SchedRow { day_type: DayType; open_time: string | null; close_time: string | null; all_day_flag: number | null; closed_flag: number | null }

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
  rows.map((r) => ({ dayType: r.day_type, openTime: r.open_time, closeTime: r.close_time, allDay: r.all_day_flag === 1, closed: r.closed_flag === 1 }));

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

export interface FeeView { status: "OK" | "UNKNOWN"; amount?: number; isFree?: boolean; reason?: string; detail?: string; notes?: string[]; days?: unknown[] }
export function feeView(r: FeeResult | { status: "UNKNOWN"; reason: string; detail: string }): FeeView {
  return r.status === "OK" ? { status: "OK", amount: r.amount, isFree: r.isFree, notes: r.notes, days: r.days } : { status: "UNKNOWN", reason: r.reason, detail: r.detail };
}

export interface LotItem {
  id: number; name: string; address: string | null; parkingType: LotRow["parking_type"]; ownershipType: LotRow["ownership_type"];
  latitude: number; longitude: number; distanceMeters: number; totalSpaces: number | null;
  fee: FeeView; operating: OperatingStatus; occupancy: OccupancyResult;
  source: { name: string; url: string | null; updatedAt: string | null; collectedAt: string; freshness: "FRESH" | "STALE" };
  isMock: boolean; qualityFlags: string[];
}

async function evaluateLot(db: Db, lot: LotRow, p: Pick<SearchParams, "startAt" | "endAt">, holidays: Set<string> | null, now: Date) {
  const feeRows = await db.all<FeeRow>("SELECT * FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [lot.id]);
  const rules = toFeeRules(feeRows);
  const fee = rules === "UNSUPPORTED"
    ? feeView({ status: "UNKNOWN", reason: "UNSUPPORTED_RULE", detail: "계산에 지원되지 않는 요금 유형 포함" })
    : feeView(calculateFee({ startAt: p.startAt, endAt: p.endAt, rules, holidays }));
  const sched = toSchedules(await db.all<SchedRow>("SELECT * FROM operating_schedules WHERE parking_lot_id=?", [lot.id]));
  const operating = operatingForStay(sched, p.startAt.getTime(), p.endAt.getTime(), holidays);
  const snap = await db.get<{ total_spaces: number | null; available_spaces: number | null; observed_at: string | null }>(
    "SELECT total_spaces, available_spaces, observed_at FROM occupancy_snapshots WHERE parking_lot_id=? ORDER BY collected_at DESC, id DESC LIMIT 1", [lot.id]);
  const occupancy = evaluateOccupancy({ totalSpaces: snap?.total_spaces, availableSpaces: snap?.available_spaces, observedAt: snap?.observed_at }, now);
  const stale = (now.getTime() - Date.parse(lot.source_updated_at ?? lot.collected_at)) / 86400_000 > STALE_DATA_DAYS;
  return { fee, operating, occupancy, freshness: (stale ? "STALE" : "FRESH") as "FRESH" | "STALE", rules, sched };
}

export interface SearchResponse {
  items: LotItem[];
  searchCenter: { lat: number; lng: number; label: string; kind: SearchParams["centerKind"] };
  requestedPeriod: { startAt: string; endAt: string; timezone: "Asia/Seoul" };
  dataCoverage: { candidates: number; returned: number; feeCalculable: number; feeUnknown: number; withValidRealtime: number; holidayDataAvailable: boolean; isMockData: boolean; excludedNoCoordinates: number };
  warnings: string[];
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

  let items: LotItem[] = [];
  for (const lot of lots) {
    const here = { lat: lot.latitude!, lng: lot.longitude! };
    const dist = distanceMeters(p.center, here);
    if (dist > p.radiusMeters) continue;
    const ev = await evaluateLot(db, lot, p, holidays, now);
    items.push({
      id: lot.id, name: lot.name, address: lot.road_address ?? lot.address, parkingType: lot.parking_type, ownershipType: lot.ownership_type,
      latitude: here.lat, longitude: here.lng, distanceMeters: Math.round(dist), totalSpaces: lot.total_spaces,
      fee: ev.fee, operating: ev.operating, occupancy: ev.occupancy,
      source: { name: lot.source_name, url: lot.source_url, updatedAt: lot.source_updated_at, collectedAt: lot.collected_at, freshness: ev.freshness },
      isMock: NON_PRODUCTION_SOURCES.includes(lot.source_name), qualityFlags: lot.quality_flags ? JSON.parse(lot.quality_flags) : [],
    });
  }
  const candidates = items.length;
  if (p.freeOnly) items = items.filter((i) => i.fee.status === "OK" && i.fee.isFree);
  if (p.realtimeOnly) items = items.filter((i) => i.occupancy.status === "AVAILABLE");
  items.sort(comparator(p.sort));
  items = items.slice(0, p.limit);

  const warnings: string[] = [];
  if (items.some((i) => i.isMock)) warnings.push("MOCK_DATA: 표시된 일부 정보는 목업 또는 샘플(검증 전) 데이터이며 실제 서비스 데이터가 아닙니다.");
  if (!holidays) warnings.push("HOLIDAY_DATA_MISSING: 입력 기간의 공휴일 데이터가 없어 요일별 규칙이 있는 시설은 요금을 계산하지 못할 수 있습니다.");
  if (items.some((i) => i.ownershipType === "UNKNOWN")) warnings.push("OWNERSHIP_UNVERIFIED: 공영 여부가 확인되지 않은 시설이 포함되어 있습니다.");
  if (items.some((i) => i.source.freshness === "STALE")) warnings.push("STALE_DATA: 오래된 데이터가 포함되어 있습니다.");
  if (candidates === 0) warnings.push("EMPTY: 조건에 맞는 주차장이 없습니다.");
  return {
    items,
    searchCenter: { lat: p.center.lat, lng: p.center.lng, label: p.centerLabel, kind: p.centerKind },
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

// 정렬: 요금 계산 불가 시설은 가격 순위에 포함하지 않고 뒤로 보낸다. 잔여면수 없음은 감점이 아니라 단지 뒤(거리순).
function comparator(sort: Sort) {
  const price = (i: LotItem) => (i.fee.status === "OK" ? i.fee.amount! : Number.POSITIVE_INFINITY);
  const avail = (i: LotItem) => (i.occupancy.status === "AVAILABLE" ? i.occupancy.availableSpaces : -1);
  const byDist = (a: LotItem, b: LotItem) => a.distanceMeters - b.distanceMeters || a.id - b.id;
  return (a: LotItem, b: LotItem) => {
    if (sort === "distance_asc") return byDist(a, b);
    if (sort === "price_asc") return price(a) - price(b) || byDist(a, b);
    if (sort === "availability_desc") return avail(b) - avail(a) || byDist(a, b);
    const free = (i: LotItem) => (i.fee.status === "OK" && i.fee.isFree ? 0 : 1); // free_first
    return free(a) - free(b) || price(a) - price(b) || byDist(a, b);
  };
}

export async function getLotDetail(db: Db, id: number, period: { startAt: Date; endAt: Date } | null, now = new Date()) {
  if (mockEnabled()) await refreshMockOccupancy(db, now);
  const lot = await db.get<LotRow>("SELECT * FROM parking_lots WHERE id=?", [id]);
  if (!lot) return null;
  const feeRules = await db.all<FeeRow>("SELECT * FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [id]);
  const schedules = await db.all<SchedRow>("SELECT * FROM operating_schedules WHERE parking_lot_id=?", [id]);
  const snap = await db.get<{ total_spaces: number | null; available_spaces: number | null; observed_at: string | null }>(
    "SELECT total_spaces, available_spaces, observed_at FROM occupancy_snapshots WHERE parking_lot_id=? ORDER BY collected_at DESC, id DESC LIMIT 1", [id]);
  const occupancy = evaluateOccupancy({ totalSpaces: snap?.total_spaces, availableSpaces: snap?.available_spaces, observedAt: snap?.observed_at }, now);
  let fee: FeeView | null = null, operating: OperatingStatus | null = null, holidayDataAvailable: boolean | null = null;
  if (period) {
    const holidays = await loadHolidays(db, period.startAt, period.endAt, now);
    holidayDataAvailable = holidays !== null;
    const ev = await evaluateLot(db, lot, period, holidays, now);
    fee = ev.fee; operating = ev.operating;
  }
  return {
    lot: {
      id: lot.id, name: lot.name, operatorName: lot.operator_name, parkingType: lot.parking_type, ownershipType: lot.ownership_type, address: lot.address, roadAddress: lot.road_address,
      latitude: lot.latitude, longitude: lot.longitude, totalSpaces: lot.total_spaces, phone: lot.phone, isMock: NON_PRODUCTION_SOURCES.includes(lot.source_name),
      qualityFlags: lot.quality_flags ? (JSON.parse(lot.quality_flags) as string[]) : [],
    },
    source: { name: lot.source_name, url: lot.source_url, updatedAt: lot.source_updated_at, collectedAt: lot.collected_at },
    feeRules: feeRules.map((r) => ({ ruleType: r.rule_type, amount: r.amount, durationMinutes: r.duration_minutes, dayType: r.valid_day_type, startTime: r.start_time, endTime: r.end_time, dailyMaxBasis: r.daily_max_basis })),
    operatingSchedules: schedules.map((s) => ({ dayType: s.day_type, openTime: s.open_time, closeTime: s.close_time, allDay: s.all_day_flag === 1, closed: s.closed_flag === 1 })),
    occupancy, fee, operating, holidayDataAvailable,
    requestedPeriod: period ? { startAt: period.startAt.toISOString(), endAt: period.endAt.toISOString(), timezone: "Asia/Seoul" } : null,
  };
}
