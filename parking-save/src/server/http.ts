import { NextResponse } from "next/server";

/** 사용자용 오류와 내부 로그 분리: 내부 오류 메시지는 응답에 포함하지 않는다 */
export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}
export function internalError(e: unknown) {
  console.error("[api] internal error", e);
  return apiError(500, "INTERNAL_ERROR", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
}

import { clientKey, type Limiter } from "./rate-limit";

/** 제한 초과 시 429 응답(Retry-After 포함), 통과 시 null */
export function limited(req: Request, limiter: Limiter): NextResponse | null {
  const r = limiter.check(clientKey(req.headers));
  if (r.ok) return null;
  const res = apiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  res.headers.set("Retry-After", String(r.retryAfterSec));
  return res;
}
