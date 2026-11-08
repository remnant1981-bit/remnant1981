import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { adminToken, audit, verifyBearer } from "@/server/admin";
import { adminLimiter, clientKey } from "@/server/rate-limit";
import { apiError, internalError, limited } from "@/server/http";
import { kasiMonthFetcher, syncHolidays } from "@/collector/holidays";

export const dynamic = "force-dynamic";

/**
 * 관리자 수집 실행 (API_SPEC.md). 인증: `Authorization: Bearer <ADMIN_API_TOKEN>`.
 * 지원 job: `holidays` (DATA_GO_KR_SERVICE_KEY 필요, 실응답 미검증 — OPEN_ISSUES #4).
 * 주차장 원천 job은 실제 어댑터 구현 후 추가.
 */
export async function POST(req: NextRequest) {
  const tooMany = limited(req, adminLimiter); // 인증 전에 제한(무차별 대입 완화)
  if (tooMany) return tooMany;
  const key = clientKey(req.headers);
  try {
    const db = await getAppDb();
    const token = adminToken();
    if (!token) { await audit(db, "sync", "REJECTED", key, "ADMIN_DISABLED"); return apiError(503, "ADMIN_DISABLED", "관리자 API가 비활성화되어 있습니다."); }
    if (!verifyBearer(req.headers.get("authorization"), token)) { await audit(db, "sync", "DENIED", key, "BAD_TOKEN"); return apiError(401, "UNAUTHORIZED", "인증이 필요합니다."); }

    let body: { job?: unknown } = {};
    try { body = await req.json(); } catch { /* 빈 본문 */ }
    if (body.job !== "holidays") { await audit(db, "sync", "REJECTED", key, "UNKNOWN_JOB"); return apiError(400, "UNKNOWN_JOB", "지원하지 않는 job입니다. (지원: holidays)"); }
    const svcKey = process.env.DATA_GO_KR_SERVICE_KEY;
    if (!svcKey) { await audit(db, "sync:holidays", "REJECTED", key, "KEY_MISSING"); return apiError(400, "KEY_MISSING", "공공데이터포털 인증키가 설정되지 않았습니다."); }

    const summary = await syncHolidays(db, kasiMonthFetcher({ serviceKey: svcKey }));
    await audit(db, "sync:holidays", summary.status === "FAILED" ? "FAILED" : "OK", key, summary.status);
    return NextResponse.json({ job: "holidays", ...summary }, { status: summary.status === "FAILED" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return internalError(e);
  }
}
