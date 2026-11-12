import { NextResponse } from "next/server";
import { isGuardError, parseActor, requireAdmin } from "@/server/admin-guard";
import { apiError, internalError } from "@/server/http";
import { decideReport } from "@/server/reports";

export const dynamic = "force-dynamic";

/** 신고 처리: { status: "REVIEWED" | "DISMISSED", by: "처리자" } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req, "admin:report");
  if (isGuardError(g)) return g;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "ID가 올바르지 않습니다.");
  const body = await req.json().catch(() => ({})) as { status?: unknown; by?: unknown };
  const by = parseActor(body.by);
  if (body.status !== "REVIEWED" && body.status !== "DISMISSED") return apiError(400, "INVALID_STATUS", "처리 상태가 올바르지 않습니다.");
  if (!by) return apiError(400, "ACTOR_REQUIRED", "처리자 이름을 입력하세요.");
  try {
    const ok = await decideReport(g.db, Number(id), body.status, by, new Date(), g.key);
    return ok ? NextResponse.json({ ok: true }) : apiError(409, "NOT_PENDING", "이미 처리됐거나 없는 신고입니다.");
  } catch (e) { return internalError(e); }
}
