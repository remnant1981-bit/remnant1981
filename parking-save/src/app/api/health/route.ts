import { NextResponse } from "next/server";
import { getAppDb } from "@/server/app-db";
import { schemaState, SYNC_STALE_HOURS } from "@/server/db-check";
import { logError, recentErrorCount } from "@/server/log";
import { STANDARD_SOURCE } from "@/collector/standard-api";
import { mapProvider } from "@/lib/map-tiles";

export const dynamic = "force-dynamic";
const startedAt = Date.now();

/**
 * 헬스체크(컨테이너·외부 모니터용). 비밀값·건수 상세 없음.
 * - 503: DB를 열 수 없음(컨테이너 재시작 대상)
 * - 200 + status "degraded": 서비스는 되지만 확인 필요(마이그레이션 누락, 표준데이터 수집 50시간 초과, 최근 5분 오류 다발, 지도 타일 설정 오류)
 *   → 컨테이너는 재시작하지 않고 외부 알림(parking-alert)이 보고함
 */
export async function GET() {
  const now = Date.now();
  try {
    const db = await getAppDb();
    const rows = await db.all<{ source_name: string; at: string | null }>(
      "SELECT source_name, MAX(finished_at) AS at FROM source_sync_logs WHERE status IN ('SUCCESS','PARTIAL') GROUP BY source_name");
    const last = Object.fromEntries(rows.map((r) => [r.source_name, r.at]));
    const schema = await schemaState(db);
    const std = last[STANDARD_SOURCE];
    const stdAgeH = std ? Math.round((now - Date.parse(std)) / 3_600_000) : null;
    const errors5m = recentErrorCount(now);
    const issues: string[] = [];
    if (schema.missing.length) issues.push("MIGRATIONS_PENDING");
    if (stdAgeH == null || stdAgeH > SYNC_STALE_HOURS) issues.push("STANDARD_SYNC_STALE");
    if (errors5m >= 20) issues.push("ERROR_BURST");
    if (mapProvider().warning) issues.push("MAP_TILE_FALLBACK"); // 브이월드·네이버로 설정했는데 키 문제로 OSM 사용 중 — 설정 확인 필요
    return NextResponse.json({
      status: issues.length ? "degraded" : "ok", issues,
      uptimeSec: Math.round((now - startedAt) / 1000), version: process.env.APP_VERSION ?? null,
      schema: { applied: schema.applied, expected: schema.expected }, errorsLast5m: errors5m,
      lastSuccessfulSync: last,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logError("health.db_unavailable", e);
    return NextResponse.json({ status: "error", issues: ["DB_UNAVAILABLE"] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
