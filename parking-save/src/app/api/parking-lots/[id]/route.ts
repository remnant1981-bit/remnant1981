import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/server/app-db";
import { getLotDetail } from "@/server/search";
import { apiError, internalError } from "@/server/http";
import { parseOffsetIso } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return apiError(400, "INVALID_ID", "주차장 ID가 올바르지 않습니다.");
  const sp = req.nextUrl.searchParams;
  let period: { startAt: Date; endAt: Date } | null = null;
  if (sp.get("startAt") || sp.get("endAt")) {
    const s = parseOffsetIso(sp.get("startAt")), e = parseOffsetIso(sp.get("endAt"));
    if (!s || !e || e <= s) return apiError(400, "INVALID_PERIOD", "주차 시작·종료 일시가 올바르지 않습니다.");
    period = { startAt: s, endAt: e };
  }
  try {
    const d = await getLotDetail(await getAppDb(), Number(id), period);
    if (!d) return apiError(404, "NOT_FOUND", "주차장을 찾을 수 없습니다.");
    return NextResponse.json(d, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return internalError(e);
  }
}
