// 데이터 품질·운영 점검 리포트 (docs/ADMIN_DATA.md). 관리자 화면 대신 CLI(`npm run quality`)로 사용.
// 읽기 전용. 개인정보(사용자 위치 등)는 다루지 않는다.
import type { Db } from "./db";
import { STALE_DATA_DAYS, feeView, loadHolidays, toFeeRules } from "./search";
import { calculateFee } from "@/domain/fee";
import { NON_PRODUCTION_SOURCES } from "./mock";
import { kstYmd } from "@/lib/time";

/** 운영 알림 임계값 — 임시값(실데이터 분포 확인 후 조정) */
export const QUALITY_THRESHOLDS = { syncMaxAgeDays: 3, recordsDropRatio: 0.3, badCoordRatio: 0.05, feeUnknownRatio: 0.5 };

export interface Alert { code: string; level: "ERROR" | "WARN" | "INFO"; message: string }
export interface SourceStatus {
  source: string; isNonProduction: boolean; lots: number; excluded: number;
  lastSync: { status: string; finishedAt: string | null; received: number | null; errorSummary: string | null } | null;
  lastSuccessAt: string | null; staleLots: number;
}
export interface QualityReport {
  generatedAt: string;
  sources: SourceStatus[];
  totals: { lots: number; withCoords: number; withTotalSpaces: number; withFeeRules: number; withSchedules: number; ownershipUnknown: number; typeUnknown: number };
  flags: Record<string, number>;
  feeCalculation: { referencePeriod: { startAt: string; endAt: string }; calculable: number; free: number; unknown: number; unknownByReason: Record<string, number>; calculableRatio: number | null };
  holidays: { coverage: Array<{ source: string; from: string; to: string; collectedAt: string; ageDays: number }>; usableForReference: boolean };
  duplicates: { pending: number };
  alerts: Alert[];
}

const days = (a: Date, b: string) => (a.getTime() - Date.parse(b)) / 86400_000;

/** 기준 기간: 오늘(KST) 다음 날부터 첫 평일 10:00~11:00 대신, 단순히 now+1일 10:00~12:00 KST. 요금 계산 가능 비율의 *지표용* 기준이며 실제 사용자 검색을 대표하지 않는다. */
function referencePeriod(now: Date) {
  const base = new Date(`${kstYmd(now.getTime() + 86400_000)}T10:00:00+09:00`);
  return { startAt: base, endAt: new Date(base.getTime() + 2 * 3600_000) };
}

export async function buildQualityReport(db: Db, now = new Date()): Promise<QualityReport> {
  const alerts: Alert[] = [];
  const one = async (sql: string, p: Array<string | number> = []) => (await db.get<{ c: number }>(sql, p))?.c ?? 0;
  const live = "data_status NOT LIKE 'EXCLUDED%'";

  // 원천별 현황
  const srcRows = await db.all<{ source_name: string; lots: number; excluded: number }>(
    `SELECT source_name, SUM(CASE WHEN ${live} THEN 1 ELSE 0 END) AS lots, SUM(CASE WHEN ${live} THEN 0 ELSE 1 END) AS excluded FROM parking_lots GROUP BY source_name`);
  const sources: SourceStatus[] = [];
  for (const r of srcRows) {
    const last = await db.get<{ status: string; finished_at: string | null; records_received: number | null; error_summary: string | null }>(
      "SELECT status, finished_at, records_received, error_summary FROM source_sync_logs WHERE source_name=? ORDER BY id DESC LIMIT 1", [r.source_name]);
    const ok = await db.get<{ finished_at: string }>("SELECT finished_at FROM source_sync_logs WHERE source_name=? AND status IN ('SUCCESS','PARTIAL') ORDER BY id DESC LIMIT 1", [r.source_name]);
    const stale = (await db.all<{ d: string | null; c: string }>(`SELECT source_updated_at AS d, collected_at AS c FROM parking_lots WHERE source_name=? AND ${live}`, [r.source_name]))
      .filter((x) => days(now, x.d ?? x.c) > STALE_DATA_DAYS).length;
    const nonProd = NON_PRODUCTION_SOURCES.includes(r.source_name);
    sources.push({ source: r.source_name, isNonProduction: nonProd, lots: r.lots, excluded: r.excluded,
      lastSync: last ? { status: last.status, finishedAt: last.finished_at, received: last.records_received, errorSummary: last.error_summary } : null,
      lastSuccessAt: ok?.finished_at ?? null, staleLots: stale });
    if (nonProd) { alerts.push({ code: "NON_PRODUCTION_SOURCE", level: "INFO", message: `${r.source_name}: 목업/샘플 원천입니다(실서비스 데이터 아님)` }); continue; }
    if (last?.status === "FAILED") alerts.push({ code: "SYNC_FAILED", level: "ERROR", message: `${r.source_name}: 마지막 수집 실패` });
    if (!ok || days(now, ok.finished_at) > QUALITY_THRESHOLDS.syncMaxAgeDays) alerts.push({ code: "SYNC_STALE", level: "ERROR", message: `${r.source_name}: ${QUALITY_THRESHOLDS.syncMaxAgeDays}일 넘게 성공한 수집 없음` });
    const prev = await db.all<{ records_received: number }>("SELECT records_received FROM source_sync_logs WHERE source_name=? AND status IN ('SUCCESS','PARTIAL') ORDER BY id DESC LIMIT 2", [r.source_name]);
    if (prev.length === 2 && prev[1].records_received! > 0 && prev[0].records_received! < prev[1].records_received! * (1 - QUALITY_THRESHOLDS.recordsDropRatio)) {
      alerts.push({ code: "RECORDS_DROP", level: "WARN", message: `${r.source_name}: 수집 건수 급감 (${prev[1].records_received} → ${prev[0].records_received})` });
    }
    if (stale > 0) alerts.push({ code: "STALE_LOTS", level: "WARN", message: `${r.source_name}: 기준일이 ${STALE_DATA_DAYS}일 넘은 시설 ${stale}곳` });
  }
  // 인증·쿼터 오류(최근 로그의 오류 요약: 공공데이터포털 오류코드)
  const errs = await db.all<{ source_name: string; error_summary: string }>("SELECT source_name, error_summary FROM source_sync_logs WHERE status='FAILED' AND error_summary IS NOT NULL ORDER BY id DESC LIMIT 20");
  for (const e of errs) {
    if (/API_(20|30|31)\b/.test(e.error_summary)) alerts.push({ code: "AUTH_FAILURE", level: "ERROR", message: `${e.source_name}: API 인증 실패(키 확인)` });
    if (/API_(22|23)\b/.test(e.error_summary)) alerts.push({ code: "QUOTA_EXCEEDED", level: "ERROR", message: `${e.source_name}: 호출 제한 초과` });
  }

  // 전체 지표
  const totals = {
    lots: await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live}`),
    withCoords: await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live} AND latitude IS NOT NULL AND longitude IS NOT NULL`),
    withTotalSpaces: await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live} AND total_spaces IS NOT NULL`),
    withFeeRules: await one(`SELECT COUNT(DISTINCT f.parking_lot_id) c FROM fee_rules f JOIN parking_lots l ON l.id=f.parking_lot_id WHERE l.${live}`),
    withSchedules: await one(`SELECT COUNT(DISTINCT o.parking_lot_id) c FROM operating_schedules o JOIN parking_lots l ON l.id=o.parking_lot_id WHERE l.${live}`),
    ownershipUnknown: await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live} AND ownership_type='UNKNOWN'`),
    typeUnknown: await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live} AND parking_type='UNKNOWN'`),
  };
  const flagRows = await db.all<{ flag: string; c: number }>(`SELECT j.value AS flag, COUNT(*) AS c FROM parking_lots l, json_each(l.quality_flags) j WHERE l.${live} AND l.quality_flags IS NOT NULL GROUP BY j.value ORDER BY c DESC`);
  const flags = Object.fromEntries(flagRows.map((f) => [f.flag, f.c]));

  // 기준 기간 요금 계산 가능 비율 (지표용)
  const ref = referencePeriod(now);
  const holidays = await loadHolidays(db, ref.startAt, ref.endAt, now);
  let calculable = 0, free = 0, unknown = 0;
  const byReason: Record<string, number> = {};
  const lots = await db.all<{ id: number }>(`SELECT id FROM parking_lots WHERE ${live}`);
  for (const l of lots) {
    const rows = await db.all<any>("SELECT * FROM fee_rules WHERE parking_lot_id=? ORDER BY id", [l.id]);
    const rules = toFeeRules(rows);
    const v = rules === "UNSUPPORTED" ? feeView({ status: "UNKNOWN", reason: "UNSUPPORTED_RULE", detail: "" })
      : feeView(calculateFee({ startAt: ref.startAt, endAt: ref.endAt, rules, holidays }));
    if (v.status === "OK") { calculable++; if (v.isFree) free++; } else { unknown++; byReason[v.reason!] = (byReason[v.reason!] ?? 0) + 1; }
  }
  const calculableRatio = lots.length ? calculable / lots.length : null;

  // 공휴일 커버리지
  const cov = await db.all<{ source_name: string; from_date: string; to_date: string; collected_at: string }>("SELECT * FROM holiday_coverage");
  const coverage = cov.map((c) => ({ source: c.source_name, from: c.from_date, to: c.to_date, collectedAt: c.collected_at, ageDays: Number(days(now, c.collected_at).toFixed(1)) }));
  const realCov = coverage.filter((c) => !NON_PRODUCTION_SOURCES.includes(c.source));
  if (realCov.length === 0) alerts.push({ code: "HOLIDAY_COVERAGE_MISSING", level: totals.lots ? "WARN" : "INFO", message: "실제 공휴일 데이터 커버리지 없음 — 요일별 규칙 시설은 요금 계산 불가" });
  else if (realCov.every((c) => c.ageDays > 7)) alerts.push({ code: "HOLIDAY_COVERAGE_EXPIRED", level: "ERROR", message: "공휴일 커버리지 만료(7일 초과) — 요일별 규칙 시설 요금 계산 불가" });

  // 데이터 이상률
  const prodTotal = totals.lots - (await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live} AND source_name IN (${NON_PRODUCTION_SOURCES.map(() => "?").join(",")})`, NON_PRODUCTION_SOURCES));
  if (prodTotal > 0) {
    const badCoord = await one(`SELECT COUNT(*) c FROM parking_lots WHERE ${live} AND (latitude IS NULL OR longitude IS NULL) AND (quality_flags IS NULL OR quality_flags NOT LIKE '%NO_COORDS_BY_DESIGN%') AND source_name NOT IN (${NON_PRODUCTION_SOURCES.map(() => "?").join(",")})`, NON_PRODUCTION_SOURCES);
    if (badCoord / prodTotal > QUALITY_THRESHOLDS.badCoordRatio) alerts.push({ code: "COORD_QUALITY", level: "WARN", message: `좌표 없음/불량 ${badCoord}/${prodTotal}곳 (${((badCoord / prodTotal) * 100).toFixed(1)}%)` });
    if (calculableRatio != null && 1 - calculableRatio > QUALITY_THRESHOLDS.feeUnknownRatio) alerts.push({ code: "FEE_UNKNOWN_HIGH", level: "INFO", message: `기준 기간 요금 계산 불가 시설 비율 ${((1 - calculableRatio) * 100).toFixed(0)}%` });
  }
  if ((flags.SOURCE_KEY_COLLISION ?? 0) > 0) alerts.push({ code: "SOURCE_KEY_COLLISION", level: "INFO", message: `원천 관리번호가 한 번의 수집에서 반복된 시설 ${flags.SOURCE_KEY_COLLISION}곳 — 같은 시설의 이중 등록일 가능성(나중 행이 반영됨)` });
  const pending = await one("SELECT COUNT(*) c FROM duplicate_candidates WHERE status='PENDING'");
  if (pending > 0) alerts.push({ code: "DUPLICATES_PENDING", level: "INFO", message: `중복 후보 ${pending}건 검토 대기(자동 병합 없음)` });

  return {
    generatedAt: now.toISOString(), sources, totals, flags,
    feeCalculation: { referencePeriod: { startAt: ref.startAt.toISOString(), endAt: ref.endAt.toISOString() }, calculable, free, unknown, unknownByReason: byReason, calculableRatio },
    holidays: { coverage, usableForReference: holidays !== null }, duplicates: { pending }, alerts,
  };
}
