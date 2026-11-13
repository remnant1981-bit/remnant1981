import { NextResponse } from "next/server";
import { isGuardError, parseActor, requireAdmin } from "@/server/admin-guard";
import { apiError, internalError } from "@/server/http";
import { applyOverride, parseOverride } from "@/server/overrides";

export const dynamic = "force-dynamic";

/** 수동 보정 적용: { kind: "FEE"|"HOURS", payload, note?, reportId?, by } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req, "admin:override");
  if (isGuardError(g)) return g;
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "ID가 올바르지 않습니다.");
  const body = await req.json().catch(() => ({})) as { by?: unknown };
  const by = parseActor(body.by);
  if (!by) return apiError(400, "ACTOR_REQUIRED", "처리자 이름을 입력하세요.");
  const parsed = parseOverride(body);
  if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
  try {
    const r = await applyOverride(g.db, Number(id), parsed, by, new Date(), g.key);
    if (!r.ok) return r.code === "LOT_NOT_FOUND" ? apiError(404, "NOT_FOUND", "없는 시설입니다.") : apiError(400, "REPORT_MISMATCH", "이 시설의 신고가 아닙니다.");
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) { return internalError(e); }
}
