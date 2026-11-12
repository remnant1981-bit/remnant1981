import { NextResponse } from "next/server";
import { isGuardError, parseActor, requireAdmin } from "@/server/admin-guard";
import { apiError, internalError } from "@/server/http";
import { decide } from "@/server/duplicates";

export const dynamic = "force-dynamic";

/** 중복 후보 결정: { decision: "MERGED" | "REJECTED", by: "처리자" } — MERGED는 레코드를 합치지 않고 '동일 시설' 연결만 기록 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req, "admin:duplicate");
  if (isGuardError(g)) return g;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "ID가 올바르지 않습니다.");
  const body = await req.json().catch(() => ({})) as { decision?: unknown; by?: unknown };
  const by = parseActor(body.by);
  if (body.decision !== "MERGED" && body.decision !== "REJECTED") return apiError(400, "INVALID_DECISION", "결정 값이 올바르지 않습니다.");
  if (!by) return apiError(400, "ACTOR_REQUIRED", "처리자 이름을 입력하세요.");
  try {
    const ok = await decide(g.db, Number(id), body.decision, by, g.key);
    return ok ? NextResponse.json({ ok: true }) : apiError(409, "NOT_PENDING", "이미 처리됐거나 없는 후보입니다.");
  } catch (e) { return internalError(e); }
}
