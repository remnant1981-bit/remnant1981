import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { apiError, internalError, limited } from "@/server/http";
import { clientKey, reportLimiter } from "@/server/rate-limit";
import { parseReport, saveReport } from "@/server/reports";

export const dynamic = "force-dynamic";

/** 정보 오류 신고 접수. 자동 반영 없음(관리자 검토). 다른 사이트에서 보낸 요청은 거부(Origin 확인) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return apiError(403, "FORBIDDEN_ORIGIN", "허용되지 않은 요청입니다.");
  const tooMany = limited(req, reportLimiter);
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "주차장 ID가 올바르지 않습니다.");
  let body: unknown;
  try { body = await req.json(); } catch { return apiError(400, "INVALID_BODY", "요청 형식이 올바르지 않습니다."); }
  const r = parseReport(body);
  if (!r.ok) return apiError(400, r.code, r.message);
  try {
    const db = await getAppDb();
    const lot = await db.get("SELECT 1 AS x FROM parking_lots WHERE id=?", [Number(id)]);
    if (!lot) return apiError(404, "NOT_FOUND", "주차장을 찾을 수 없습니다.");
    const saved = await saveReport(db, Number(id), r, clientKey(req.headers));
    return NextResponse.json({ ok: true, duplicate: saved.duplicate }, { status: saved.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return internalError(e);
  }
}
