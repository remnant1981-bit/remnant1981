// 관리자 API 공통 관문: 요청 제한 → 토큰 확인(상수 시간 비교) → 실패는 감사로그. 통과하면 DB와 클라이언트 키 반환
import type { NextResponse } from "next/server";
import type { Db } from "./db";
import { getAppDb } from "./app-db";
import { adminToken, audit, verifyBearer } from "./admin";
import { apiError, limited } from "./http";
import { adminUiLimiter, clientKey } from "./rate-limit";

export async function requireAdmin(req: Request, action: string): Promise<{ db: Db; key: string } | NextResponse> {
  const tooMany = limited(req, adminUiLimiter);
  if (tooMany) return tooMany;
  const key = clientKey(req.headers);
  const db = await getAppDb();
  const token = adminToken();
  if (!token) { await audit(db, action, "REJECTED", key, "ADMIN_DISABLED"); return apiError(503, "ADMIN_DISABLED", "관리자 API가 비활성화되어 있습니다."); }
  if (!verifyBearer(req.headers.get("authorization"), token)) { await audit(db, action, "DENIED", key, "BAD_TOKEN"); return apiError(401, "UNAUTHORIZED", "인증이 필요합니다."); }
  return { db, key };
}
export const isGuardError = (x: unknown): x is NextResponse => x instanceof Response;

/** 처리자 이름: 감사·기록용(1~60자) */
export function parseActor(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, 60) : null;
}
