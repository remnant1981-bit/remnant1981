import { NextResponse } from "next/server";
import { isGuardError, requireAdmin } from "@/server/admin-guard";
import { internalError } from "@/server/http";
import { listPending } from "@/server/duplicates";
import { listReports } from "@/server/reports";
import { listOverrides } from "@/server/overrides";

export const dynamic = "force-dynamic";

/** 관리자 현황: 검토 대기 신고·중복 후보, 원천별 마지막 수집 */
export async function GET(req: Request) {
  const g = await requireAdmin(req, "admin:overview");
  if (isGuardError(g)) return g;
  try {
    const sync = await g.db.all<{ source_name: string; status: string; started_at: string; finished_at: string | null; records_received: number | null; error_summary: string | null }>(
      `SELECT s.source_name, s.status, s.started_at, s.finished_at, s.records_received, s.error_summary FROM source_sync_logs s
       JOIN (SELECT source_name, MAX(id) AS id FROM source_sync_logs GROUP BY source_name) m ON m.id = s.id ORDER BY s.source_name`);
    const counts = await g.db.get<{ reports: number; duplicates: number }>(
      "SELECT (SELECT COUNT(*) FROM lot_reports WHERE status='NEW') AS reports, (SELECT COUNT(*) FROM duplicate_candidates WHERE status='PENDING') AS duplicates");
    // 수집 이력(원천별 최근 14회): 받은 건수 추이 그래프용
    const history = await g.db.all<{ source_name: string; status: string; started_at: string; records_received: number | null }>(
      `SELECT source_name, status, started_at, records_received FROM (
         SELECT source_name, status, started_at, records_received, ROW_NUMBER() OVER (PARTITION BY source_name ORDER BY id DESC) AS rn FROM source_sync_logs WHERE status <> 'RUNNING')
       WHERE rn <= 14 ORDER BY source_name, started_at`);
    return NextResponse.json({ counts, sync, syncHistory: history, reports: await listReports(g.db, "NEW", 50), duplicates: await listPending(g.db, 50), overrides: await listOverrides(g.db, 50) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return internalError(e); }
}
