import { NextResponse } from "next/server";
import { isGuardError, requireAdmin } from "@/server/admin-guard";
import { internalError } from "@/server/http";
import { buildQualityReport } from "@/server/quality";

export const dynamic = "force-dynamic";

/** 데이터 품질·운영 알림 리포트(npm run quality와 같은 내용) */
export async function GET(req: Request) {
  const g = await requireAdmin(req, "admin:quality");
  if (isGuardError(g)) return g;
  try { return NextResponse.json(await buildQualityReport(g.db), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return internalError(e); }
}
