import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { apiError, internalError, limited } from "@/server/http";
import { clientKey, reportLimiter } from "@/server/rate-limit";
import { parseReport, saveReport } from "@/server/reports";
import { countUsage } from "@/server/usage";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8 * 1024;
const sameHost = (origin: string, host: string | null) => { try { return new URL(origin).host === host; } catch { return false; } };

/** 정보 오류 신고 접수. 자동 반영 없음(관리자 검토). 다른 사이트에서 보낸 요청은 거부(Origin 확인) */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Origin이 있으면 같은 사이트여야 함. "null"(샌드박스 iframe 등)·잘못된 값은 거부(예외로 500이 나지 않게)
  const origin = req.headers.get("origin");
  if (origin && sameHost(origin, req.headers.get("host")) !== true) return apiError(403, "FORBIDDEN_ORIGIN", "허용되지 않은 요청입니다.");
  // 본문 크기 상한(신고 내용 500자 + 여유). nginx 64KB 제한과 별개로 앱에서도 막음
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return apiError(413, "BODY_TOO_LARGE", "요청이 너무 큽니다.");
  const tooMany = limited(req, reportLimiter);
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "주차장 ID가 올바르지 않습니다.");
  let body: unknown;
  try {
    const text = await req.text(); // content-length 없이 보낸 경우(청크 전송)도 실제 크기로 한 번 더 확인
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return apiError(413, "BODY_TOO_LARGE", "요청이 너무 큽니다.");
    body = JSON.parse(text);
  } catch { return apiError(400, "INVALID_BODY", "요청 형식이 올바르지 않습니다."); }
  const r = parseReport(body);
  if (!r.ok) return apiError(400, r.code, r.message);
  try {
    const db = await getAppDb();
    const lot = await db.get("SELECT 1 AS x FROM parking_lots WHERE id=?", [Number(id)]);
    if (!lot) return apiError(404, "NOT_FOUND", "주차장을 찾을 수 없습니다.");
    const saved = await saveReport(db, Number(id), r, clientKey(req.headers));
    if (!saved.duplicate) countUsage("report");
    return NextResponse.json({ ok: true, duplicate: saved.duplicate }, { status: saved.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return internalError(e);
  }
}
