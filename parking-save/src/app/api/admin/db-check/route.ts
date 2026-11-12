import { NextResponse } from "next/server";
import { isGuardError, requireAdmin } from "@/server/admin-guard";
import { internalError } from "@/server/http";
import { deepCheck, deepCheckOk } from "@/server/db-check";

export const dynamic = "force-dynamic";

/** DB 무결성 전체 점검(PRAGMA integrity_check·외래키·마이그레이션). 수 초 걸릴 수 있어 관리자 전용 */
export async function GET(req: Request) {
  const g = await requireAdmin(req, "admin:db-check");
  if (isGuardError(g)) return g;
  try {
    const r = await deepCheck(g.db);
    return NextResponse.json({ ok: deepCheckOk(r), ...r }, { status: deepCheckOk(r) ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return internalError(e); }
}
