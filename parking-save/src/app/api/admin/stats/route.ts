import { NextResponse } from "next/server";
import { isGuardError, requireAdmin } from "@/server/admin-guard";
import { internalError } from "@/server/http";
import { usageSeries } from "@/server/usage";
import { STANDARD_SOURCE } from "@/collector/standard-api";

export const dynamic = "force-dynamic";

/** 운영 현황: 일별 이용 합계(최근 30일), 일별 신고 접수, 데이터 신선도. 개인 단위 정보 없음 */
export async function GET(req: Request) {
  const g = await requireAdmin(req, "admin:stats");
  if (isGuardError(g)) return g;
  try {
    const days = 30, now = Date.now();
    const series = await usageSeries(g.db, days, now);
    const from = series[0].ymd;
    const reportRows = await g.db.all<{ ymd: string; n: number }>(
      "SELECT substr(datetime(created_at, '+9 hours'), 1, 10) AS ymd, COUNT(*) AS n FROM lot_reports WHERE datetime(created_at, '+9 hours') >= ? GROUP BY ymd", [from]);
    const reports = Object.fromEntries(reportRows.map((r) => [r.ymd, r.n]));
    const lastStd = (await g.db.get<{ t: string | null }>("SELECT MAX(finished_at) AS t FROM source_sync_logs WHERE source_name=? AND status IN ('SUCCESS','PARTIAL')", [STANDARD_SOURCE]))?.t ?? null;
    const counts = await g.db.get<{ lots: number; pending: number; overrides: number }>(
      "SELECT (SELECT COUNT(*) FROM parking_lots WHERE data_status NOT LIKE 'EXCLUDED%') AS lots, (SELECT COUNT(*) FROM lot_reports WHERE status='NEW') AS pending, (SELECT COUNT(*) FROM lot_overrides WHERE status='ACTIVE') AS overrides");
    return NextResponse.json({
      days: series.map((d) => ({ ymd: d.ymd, ...d.metrics, reports_received: reports[d.ymd] ?? 0 })),
      freshness: { standardLastSuccess: lastStd, standardAgeHours: lastStd ? Math.round((now - Date.parse(lastStd)) / 3_600_000) : null },
      counts,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return internalError(e); }
}
