import { NextResponse } from "next/server";
import { getAppDb } from "@/server/app-db";

export const dynamic = "force-dynamic";

/**
 * 헬스체크(컨테이너·로드밸런서용). DB 연결과 원천별 마지막 성공 수집 시각만 돌려준다(비밀값·건수 상세 없음).
 * DB를 열 수 없으면 503.
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const rows = await db.all<{ source_name: string; at: string | null }>(
      "SELECT source_name, MAX(finished_at) AS at FROM source_sync_logs WHERE status IN ('SUCCESS','PARTIAL') GROUP BY source_name");
    return NextResponse.json({ status: "ok", lastSuccessfulSync: Object.fromEntries(rows.map((r) => [r.source_name, r.at])) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health]", e);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
