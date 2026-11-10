import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { adminToken, audit, verifyBearer } from "@/server/admin";
import { adminLimiter, clientKey } from "@/server/rate-limit";
import { apiError, internalError, limited } from "@/server/http";
import { kasiMonthFetcher, syncHolidays } from "@/collector/holidays";
import { StandardApiAdapter, standardPageFetcher } from "@/collector/standard-api";
import { runSync } from "@/collector/runner";
import { SEOUL_DEFAULT_BASE, seoulPageFetcher, syncSeoulOccupancy } from "@/collector/seoul-sync";

export const dynamic = "force-dynamic";

/**
 * 관리자 수집 실행 (API_SPEC.md). 인증: `Authorization: Bearer <ADMIN_API_TOKEN>`.
 * 지원 job: `holidays` (DATA_GO_KR_SERVICE_KEY 필요, 실응답 미검증 — OPEN_ISSUES #4),
 *            `standard-parking` (DATA_GO_KR_SERVICE_KEY 필요, 응답 봉투 미검증 — OPEN_ISSUES #1),
 *            `seoul-occupancy` (SEOUL_OPENAPI_KEY 필요, 응답 형식은 공개 샘플키로 검증 — OPEN_ISSUES #3).
 * 주차장 원천 job은 실제 어댑터 구현 후 추가.
 */
/** 같은 job의 동시 실행 방지(표준데이터 전체 수집은 1분 이상 걸려, 겹치면 DB 쓰기 경합·외부 API 호출 한도 낭비) */
const running = new Set<string>();
const KNOWN_JOBS = ["holidays", "seoul-occupancy", "standard-parking"];

export async function POST(req: NextRequest) {
  const tooMany = limited(req, adminLimiter); // 인증 전에 제한(무차별 대입 완화)
  if (tooMany) return tooMany;
  const key = clientKey(req.headers);
  let acquired: string | null = null;
  try {
    const db = await getAppDb();
    const token = adminToken();
    if (!token) { await audit(db, "sync", "REJECTED", key, "ADMIN_DISABLED"); return apiError(503, "ADMIN_DISABLED", "관리자 API가 비활성화되어 있습니다."); }
    if (!verifyBearer(req.headers.get("authorization"), token)) { await audit(db, "sync", "DENIED", key, "BAD_TOKEN"); return apiError(401, "UNAUTHORIZED", "인증이 필요합니다."); }

    let body: { job?: unknown } = {};
    try { body = await req.json(); } catch { /* 빈 본문 */ }
    if (typeof body.job === "string" && KNOWN_JOBS.includes(body.job)) {
      if (running.has(body.job)) { await audit(db, `sync:${body.job}`, "REJECTED", key, "ALREADY_RUNNING"); return apiError(409, "ALREADY_RUNNING", "같은 수집이 이미 실행 중입니다."); }
      running.add(body.job); acquired = body.job;
    }
    if (body.job === "standard-parking") {
      const dk = process.env.DATA_GO_KR_SERVICE_KEY;
      if (!dk) { await audit(db, "sync:standard-parking", "REJECTED", key, "KEY_MISSING"); return apiError(400, "KEY_MISSING", "공공데이터포털 인증키가 설정되지 않았습니다."); }
      const summary = await runSync(db, new StandardApiAdapter(standardPageFetcher({ serviceKey: dk }), Number(process.env.STANDARD_PAGE_SIZE) || 100));
      await audit(db, "sync:standard-parking", summary.status === "FAILED" ? "FAILED" : "OK", key, summary.status);
      return NextResponse.json({ job: "standard-parking", ...summary }, { status: summary.status === "FAILED" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
    }
    if (body.job === "seoul-occupancy") {
      const sk = process.env.SEOUL_OPENAPI_KEY;
      if (!sk) { await audit(db, "sync:seoul-occupancy", "REJECTED", key, "KEY_MISSING"); return apiError(400, "KEY_MISSING", "서울 열린데이터광장 인증키가 설정되지 않았습니다."); }
      const summary = await syncSeoulOccupancy(db, seoulPageFetcher({ key: sk, baseUrl: process.env.SEOUL_OPENAPI_BASE || SEOUL_DEFAULT_BASE }));
      await audit(db, "sync:seoul-occupancy", summary.status === "FAILED" ? "FAILED" : "OK", key, summary.status);
      return NextResponse.json({ job: "seoul-occupancy", ...summary }, { status: summary.status === "FAILED" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
    }
    if (body.job !== "holidays") { await audit(db, "sync", "REJECTED", key, "UNKNOWN_JOB"); return apiError(400, "UNKNOWN_JOB", "지원하지 않는 job입니다. (지원: holidays, seoul-occupancy, standard-parking)"); }
    const svcKey = process.env.DATA_GO_KR_SERVICE_KEY;
    if (!svcKey) { await audit(db, "sync:holidays", "REJECTED", key, "KEY_MISSING"); return apiError(400, "KEY_MISSING", "공공데이터포털 인증키가 설정되지 않았습니다."); }

    const summary = await syncHolidays(db, kasiMonthFetcher({ serviceKey: svcKey }));
    await audit(db, "sync:holidays", summary.status === "FAILED" ? "FAILED" : "OK", key, summary.status);
    return NextResponse.json({ job: "holidays", ...summary }, { status: summary.status === "FAILED" ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return internalError(e);
  } finally {
    if (acquired) running.delete(acquired);
  }
}
