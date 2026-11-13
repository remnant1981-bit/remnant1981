import { NextResponse } from "next/server";
import { isGuardError, parseActor, requireAdmin } from "@/server/admin-guard";
import { apiError, internalError } from "@/server/http";
import { revertOverride } from "@/server/overrides";

export const dynamic = "force-dynamic";

/** 보정 되돌리기(원천 값 복원): { by } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req, "admin:override-revert");
  if (isGuardError(g)) return g;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "ID가 올바르지 않습니다.");
  const by = parseActor(((await req.json().catch(() => ({}))) as { by?: unknown }).by);
  if (!by) return apiError(400, "ACTOR_REQUIRED", "처리자 이름을 입력하세요.");
  try {
    return (await revertOverride(g.db, Number(id), by, new Date(), g.key)) ? NextResponse.json({ ok: true }) : apiError(409, "NOT_ACTIVE", "적용 중인 보정이 아닙니다.");
  } catch (e) { return internalError(e); }
}
